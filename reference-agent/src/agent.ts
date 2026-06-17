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
 */

import type {
  AgentStep,
  Executor,
  GenerateResult,
  ModelProvider,
  PlanFeedback,
  Planner,
  TokenUsage,
  Validator,
} from "@grade-stack/core";
import { DEFAULT_MAX_TURNS, runPEV, zodValidator } from "@grade-stack/core";
import type { SupportEmail } from "./sample-email.ts";
import { type Triage, TriageSchema } from "./triage-schema.ts";

// Re-exported so existing consumers keep importing the turn bound from here even
// though the mechanism now lives in core with the PEV loop it guards.
export { type AgentStep, DEFAULT_MAX_TURNS, MaxTurnsError } from "@grade-stack/core";

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
}

function resolveMaxTurns(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.RELIABILITY_MAX_TURNS;
  if (fromEnv !== undefined) {
    const n = Number.parseInt(fromEnv, 10);
    if (!Number.isNaN(n)) return n;
  }
  return DEFAULT_MAX_TURNS;
}

function resolveDegraded(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const v = process.env.RELIABILITY_DEGRADED?.toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Degraded mode: strip the structured contract from the agent's output. This is
 * a real, provider-independent quality regression — the validator's field/enum
 * checks and the judge no longer pass — used to demonstrate the eval gate
 * blocking a bad PR and retained as a permanent canary. Applied to the output
 * *after* the agent has converged, so degradation is a deliberate sabotage of a
 * known-good result, never an input to any rating.
 */
function degrade(text: string): string {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    delete o.draft_reply;
    delete o.summary;
    return JSON.stringify(o);
  } catch {
    return "unable to triage this request";
  }
}

const BASE_SYSTEM_PROMPT = [
  "You are a customer-support triage assistant.",
  "Given one inbound support email, classify it and draft a reply.",
  "Respond with a single JSON object — and nothing else, no Markdown fences —",
  "that conforms exactly to this JSON Schema:",
].join("\n");

function renderUserPrompt(email: SupportEmail): string {
  return [
    "Triage the following support email.",
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
function makeTriagePlanner(jsonSchema: Record<string, unknown>): Planner<SupportEmail, TriagePlan> {
  const system = `${BASE_SYSTEM_PROMPT}\n${JSON.stringify(jsonSchema, null, 2)}`;
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

/** The executor: turns a plan into the single bounded model call. */
function makeTriageExecutor(provider: ModelProvider): Executor<TriagePlan> {
  return {
    execute(plan: TriagePlan): Promise<GenerateResult> {
      return provider.generate({
        system: plan.system,
        messages: [{ role: "user", content: plan.user }],
        maxTokens: 800,
        temperature: 0,
      });
    },
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

  const validator: Validator<Triage> = zodValidator(TriageSchema);
  const planner = makeTriagePlanner(validator.jsonSchema);
  const executor = makeTriageExecutor(provider);

  const result = await runPEV(email, planner, executor, validator, { maxTurns });

  return {
    raw: degraded ? degrade(result.text) : result.text,
    triage: result.value,
    steps: result.steps,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
    turns: result.turns,
    degraded,
  };
}
