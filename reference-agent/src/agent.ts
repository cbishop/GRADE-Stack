// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/agent
 *
 * The reference agent: triages one support email through the explicit
 * Planner → Executor → Validator loop from `@grade-stack/core` (Phase 2A). The
 * planner shapes the prompt (and re-plans from validator feedback), the executor
 * makes the one model call, and the validator enforces the {@link TriageSchema}
 * contract. The whole loop is turn-bounded and carries a degraded-mode canary
 * (Phase 1B). Task-specific wiring lives here; the reusable loop lives in core.
 * Phase 4C stamps the release manifest (`./release`) onto the root span.
 * Phase 4D: when the gateway holds the accepted answer for a named person, the
 * result says so (`review: { required, reason, id }`).
 * Phase 4E: each run opens its own gateway session (`withSession`), so the
 * gateway's per-session turn cap from the agent's manifest bounds each run.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentStep,
  Executor,
  GenerateResult,
  ModelProvider,
  PlanFeedback,
  Planner,
  ReviewHold,
  TokenUsage,
  Validator,
} from "@grade-stack/core";
import {
  GENAI,
  releaseSpanAttributes,
  runPEV,
  SpanKind,
  traceProvider,
  withSpan,
  zodValidator,
} from "@grade-stack/core";
import { resolveMaxTurns, TRIAGE_GENERATION, triageSystemPrompt } from "./config.ts";
import {
  connectSupportTools,
  type Grounding,
  groundTriage,
  type SupportToolsClient,
} from "./mcp.ts";
import { referenceAgentRelease } from "./release.ts";
import type { SupportEmail } from "./sample-email.ts";
import { type Triage, TriageSchema } from "./triage-schema.ts";

// Re-exported so existing consumers keep importing the turn bound from here even
// though the mechanism now lives in core with the PEV loop it guards.
export { type AgentStep, DEFAULT_MAX_TURNS, MaxTurnsError } from "@grade-stack/core";

/**
 * Whether a person must review this triage before anything is sent (Phase 4D).
 * `required` is true when the gateway held the accepted answer; `id` is the
 * review item (`reliability review show <id>`) and `reason` says why.
 */
export interface TriageReview {
  required: boolean;
  reason?: string;
  id?: string;
}

export interface TriageResult {
  /**
   * The agent's output as a JSON string. In normal mode this is the canonical
   * serialization of the schema-valid {@link Triage}; in degraded mode it is
   * the deliberately-corrupted output (the gate canary).
   */
  raw: string;
  /** The schema-valid triage the validator accepted (pre-degradation). */
  triage: Triage;
  /** The planner/executor/validator trace (plan → execute → validate ×turns). */
  steps: AgentStep[];
  usage: TokenUsage;
  provider: string;
  model: string;
  /** How many model turns the agent took (bounded by maxTurns). */
  turns: number;
  /** Whether degraded mode deliberately worsened the output. */
  degraded: boolean;
  /**
   * The MCP grounding the agent consumed (policy resource + selected tool), or
   * `undefined` when run without MCP. Present so the trace and demos can show
   * which tool the model selected from descriptions alone (Phase 2B).
   */
  grounding?: Grounding;
  /** Held for human review by the gateway (Phase 4D); `required: false` otherwise. */
  review: TriageReview;
}

export interface RunAgentOptions {
  /**
   * Hard upper bound on model turns. **Enforced**, not suggested: if the agent
   * fails to converge within this many turns it throws `MaxTurnsError` rather
   * than looping. Defaults to RELIABILITY_MAX_TURNS, then DEFAULT_MAX_TURNS.
   */
  maxTurns?: number;
  /**
   * Deliberately worsen the agent's output (drops the structured contract) so
   * the eval gate has a regression to catch. Defaults to RELIABILITY_DEGRADED.
   * Kept permanently as a gate canary (Phase 1B).
   */
  degraded?: boolean;
  /**
   * Consume the MCP server (Phase 2B) before planning: read the triage-policy
   * resource and let the model select a tool from descriptions to ground the
   * triage. `true` spawns the server over stdio; pass a {@link SupportToolsClient}
   * to reuse an existing connection (or a different transport). Defaults to
   * RELIABILITY_MCP, then off — so the deterministic eval baseline is untouched.
   */
  mcp?: boolean | SupportToolsClient;
}

/**
 * Whether degraded mode is on: an explicit flag, else `RELIABILITY_DEGRADED`.
 * Exported (Phase 4F) so trace re-scoring applies the same canary to replayed
 * outputs that a live run applies to fresh ones.
 */
export function resolveDegraded(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const v = process.env.RELIABILITY_DEGRADED?.toLowerCase();
  return v === "1" || v === "true";
}

function resolveMcp(explicit?: boolean | SupportToolsClient): boolean | SupportToolsClient {
  if (explicit !== undefined) return explicit;
  const v = process.env.RELIABILITY_MCP?.toLowerCase();
  return v === "1" || v === "true";
}

function reviewOf(hold: ReviewHold | undefined): TriageReview {
  return hold ? { required: true, reason: hold.reason, id: hold.id } : { required: false };
}

function taskFromEmail(email: SupportEmail): string {
  return [`From: ${email.from}`, `Subject: ${email.subject}`, "", email.body].join("\n");
}

/**
 * Degraded mode: strip the structured contract from the agent's output. This is
 * a real, provider-independent quality regression — the validator's field/enum
 * checks and the judge no longer pass — used to demonstrate the eval gate
 * blocking a bad PR and retained as a permanent canary. Applied to the output
 * *after* the agent has converged, so degradation is a deliberate sabotage of a
 * known-good result, never an input to any rating.
 */
export function degradeOutput(text: string): string {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    delete o.draft_reply;
    delete o.summary;
    return JSON.stringify(o);
  } catch {
    return "unable to triage this request";
  }
}

/**
 * The first line of every triage prompt. Trace re-scoring (Phase 4F) uses it to
 * tell a captured triage answer from the agent's other model calls.
 */
export const TRIAGE_PROMPT_LEAD = "Triage the following support email.";

function renderUserPrompt(email: SupportEmail): string {
  return [
    TRIAGE_PROMPT_LEAD,
    "",
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    "",
    email.body,
  ].join("\n");
}

interface TriagePlan {
  system: string;
  user: string;
}

/**
 * The planner: shapes the prompt around the schema contract and, on a re-plan,
 * folds the validator's issues back in as explicit repair instructions. It makes
 * no model call — planning is deterministic, so turns == executor calls.
 */
function makeTriagePlanner(
  jsonSchema: Record<string, unknown>,
  grounding?: Grounding,
): Planner<SupportEmail, TriagePlan> {
  const schemaBlock = triageSystemPrompt(jsonSchema);
  // MCP grounding (policy resource + selected-tool facts) is prepended as context
  // the planner can use, but it never relaxes the schema the validator enforces.
  const system = grounding ? `${grounding.context}\n\n${schemaBlock}` : schemaBlock;
  return {
    plan(email: SupportEmail, feedback: PlanFeedback): TriagePlan {
      let user = renderUserPrompt(email);
      if (feedback.priorIssues.length > 0) {
        user += [
          "",
          "",
          "Your previous response was rejected by the schema validator for:",
          ...feedback.priorIssues.map((i) => `  - ${i}`),
          "Return a corrected JSON object that fixes every issue above.",
        ].join("\n");
      }
      return { system, user };
    },
  };
}

/**
 * The executor: turns a plan into the single bounded model call. It remembers
 * the gateway's review hold on the latest call: the PEV loop stops at the first
 * schema-valid answer, so the latest call is the accepted one.
 */
function makeTriageExecutor(provider: ModelProvider): Executor<TriagePlan> & {
  lastReview(): ReviewHold | undefined;
} {
  let last: ReviewHold | undefined;
  return {
    async execute(plan: TriagePlan): Promise<GenerateResult> {
      const result = await provider.generate({
        system: plan.system,
        messages: [{ role: "user", content: plan.user }],
        ...TRIAGE_GENERATION,
      });
      last = result.review;
      return result;
    },
    lastReview: () => last,
  };
}

/**
 * The reference agent: triage one support email through the explicit
 * Planner → Executor → Validator loop. The validator enforces
 * {@link TriageSchema} — output that doesn't conform is rejected and the agent
 * re-plans with that feedback, up to the enforced turn bound. Runs identically
 * against any {@link ModelProvider}; the loop and its bound live in core.
 */
export async function runReferenceAgent(
  provider: ModelProvider,
  email: SupportEmail,
  opts: RunAgentOptions = {},
): Promise<TriageResult> {
  const maxTurns = resolveMaxTurns(opts.maxTurns);
  const degraded = resolveDegraded(opts.degraded);
  const mcp = resolveMcp(opts.mcp);

  // Every model call (tool selection + the PEV executor) flows through this
  // wrapper, so each one emits a GenAI `chat` span under the right parent. It is
  // transparent and a no-op when tracing is off (Phase 2D).
  // 4E: one gateway session per run, so the manifest's turn cap is per run.
  const tracedProvider = traceProvider(provider.withSession?.(randomUUID()) ?? provider);

  // The root span: the whole run hangs off it, giving one connected trace
  // (plan → tool calls → validation). No-op when tracing is inactive.
  return withSpan(
    "agent.run",
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [GENAI.operationName]: "invoke_agent",
        [GENAI.agentName]: "reference-agent",
        // Phase 4C: the release manifest, so a trace names the version it ran.
        ...releaseSpanAttributes(referenceAgentRelease(provider, { maxTurns })),
      },
    },
    async (span) => {
      // ── MCP grounding (opt-in, Phase 2B) ──────────────────────────────────
      // Consume the MCP server before planning: read the policy resource and let
      // the model pick a tool from descriptions. A connection we open here we
      // also close; a caller-supplied client is left open for the caller.
      let grounding: Grounding | undefined;
      if (mcp) {
        const ownedClient = typeof mcp === "object" ? undefined : await connectSupportTools();
        const client = ownedClient ?? (mcp as SupportToolsClient);
        try {
          grounding = await groundTriage(tracedProvider, client, taskFromEmail(email));
        } finally {
          if (ownedClient) await ownedClient.close();
        }
      }

      const validator: Validator<Triage> = zodValidator(TriageSchema);
      const planner = makeTriagePlanner(validator.jsonSchema, grounding);
      const executor = makeTriageExecutor(tracedProvider);

      const result = await runPEV(email, planner, executor, validator, { maxTurns });

      span.setAttributes({
        [GENAI.system]: result.provider,
        [GENAI.responseModel]: result.model,
        "grade_stack.turns": result.turns,
      });

      return {
        raw: degraded ? degradeOutput(result.text) : result.text,
        triage: result.value,
        steps: result.steps,
        usage: result.usage,
        provider: result.provider,
        model: result.model,
        turns: result.turns,
        degraded,
        grounding,
        review: reviewOf(executor.lastReview()),
      };
    },
  );
}
