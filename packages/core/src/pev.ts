// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/pev
 *
 * The reusable Planner → Executor → Validator (PEV) agent pattern. This is the
 * mid-market default shape for an agent: a planner decides the approach, an
 * executor calls the model, and a validator enforces a **schema contract** on
 * the result — re-planning with the validator's feedback until the output
 * conforms or a bounded turn budget is exhausted.
 *
 * This module owns the *generic* loop, the trace it emits, the enforced turn
 * bound, and the Zod-schema-backed validator. It deliberately does **not** own
 * any task-specific planner/executor/validator — those live with the agent
 * (e.g. `reference-agent`). The validator's `jsonSchema` (derived from Zod) is
 * the structured-output contract: conformance is enforced by a parse here, not
 * hoped for in a prompt (Phase 2A).
 */

import { z } from "zod";
import type { GenerateResult, ProviderName, TokenUsage } from "./types.ts";

/** The three explicit phases every PEV step is attributed to. */
export type AgentPhase = "plan" | "execute" | "validate";

/** Outcome of a single phase on a single attempt. */
export type StepStatus = "ok" | "fail";

/**
 * One entry in the agent's execution trace: a phase, its outcome, and which
 * attempt it belonged to. The Phase 1A eval schema (`plan`/`execute`/`validate`)
 * maps 1:1 onto these so trace-level scoring survives the 2A refactor.
 */
export interface AgentStep {
  phase: AgentPhase;
  status: StepStatus;
  /** Human-readable detail of what happened in this step. */
  detail: string;
  /** 1-based attempt this step belongs to. */
  attempt: number;
}

/** Default upper bound on model turns (one model call per attempt). */
export const DEFAULT_MAX_TURNS = 4;

/**
 * Thrown when the PEV loop hits its turn bound without producing schema-valid
 * output. The bound is **enforced**, not suggested (Phase 1B): a runaway
 * planner/executor/validator loop throws rather than spinning forever.
 */
export class MaxTurnsError extends Error {
  constructor(
    readonly maxTurns: number,
    /** The validator issues from the final failed attempt, if any. */
    readonly lastIssues: string[] = [],
  ) {
    const tail = lastIssues.length > 0 ? ` Last validation issues: ${lastIssues.join("; ")}` : "";
    super(`Agent exceeded its turn bound of ${maxTurns} without converging.${tail}`);
    this.name = "MaxTurnsError";
  }
}

/** The result of validating one executor output against the schema contract. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/**
 * A structured-output contract. `jsonSchema` is the machine-readable schema the
 * executor should target; `validate` is the enforcement: it rejects any output
 * that does not conform. Build one from a Zod schema with {@link zodValidator}.
 */
export interface Validator<T> {
  /** JSON Schema describing the required output — handed to the executor. */
  readonly jsonSchema: Record<string, unknown>;
  /** Extract + validate the model's raw text against the contract. */
  validate(rawOutput: string): ValidationResult<T>;
}

/** Feedback handed to the planner on each attempt to drive a real re-plan. */
export interface PlanFeedback {
  /** 1-based attempt number. */
  attempt: number;
  /** Validator issues from the previous attempt (empty on the first). */
  priorIssues: string[];
}

/** Produces an execution plan from the input, incorporating prior feedback. */
export interface Planner<I, P> {
  plan(input: I, feedback: PlanFeedback): P;
}

/** Turns a plan into a single model call. */
export interface Executor<P> {
  execute(plan: P): Promise<GenerateResult>;
}

/** The fully-typed result of a PEV run. */
export interface PEVResult<T> {
  /** The schema-valid value the agent converged on. */
  value: T;
  /** Canonical JSON serialization of {@link value} — the contract output. */
  text: string;
  /** Per-phase, per-attempt trace (plan → execute → validate ×N). */
  steps: AgentStep[];
  /** Token usage summed across every attempt. */
  usage: TokenUsage;
  provider: ProviderName;
  model: string;
  /** Model turns taken (== attempts == executor calls). */
  turns: number;
}

export interface RunPEVOptions {
  /** Enforced upper bound on model turns. */
  maxTurns: number;
}

/**
 * Run the bounded Planner → Executor → Validator loop.
 *
 * Each attempt: plan (deterministic, no model call) → execute (one model call)
 * → validate (schema parse). On a validation failure the loop re-plans with the
 * validator's issues fed back in, up to `maxTurns`. If no attempt produces
 * schema-valid output the loop throws {@link MaxTurnsError} — the bound is the
 * mechanism, not a comment. `maxTurns: 0` throws before any model call.
 */
export async function runPEV<I, P, T>(
  input: I,
  planner: Planner<I, P>,
  executor: Executor<P>,
  validator: Validator<T>,
  opts: RunPEVOptions,
): Promise<PEVResult<T>> {
  const steps: AgentStep[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let priorIssues: string[] = [];

  for (let attempt = 1; attempt <= opts.maxTurns; attempt += 1) {
    // ── plan ────────────────────────────────────────────────────────────────
    const plan = planner.plan(input, { attempt, priorIssues });
    steps.push({
      phase: "plan",
      status: "ok",
      attempt,
      detail:
        attempt === 1
          ? "Planned the triage approach."
          : `Re-planned to repair: ${priorIssues.join("; ")}`,
    });

    // ── execute ──────────────────────────────────────────────────────────────
    const out = await executor.execute(plan);
    usage.inputTokens += out.usage.inputTokens;
    usage.outputTokens += out.usage.outputTokens;
    steps.push({
      phase: "execute",
      status: "ok",
      attempt,
      detail: `Model produced ${out.text.length} chars.`,
    });

    // ── validate ─────────────────────────────────────────────────────────────
    const result = validator.validate(out.text);
    if (result.ok) {
      steps.push({
        phase: "validate",
        status: "ok",
        attempt,
        detail: "Output conforms to the schema contract.",
      });
      return {
        value: result.value,
        text: JSON.stringify(result.value),
        steps,
        usage,
        provider: out.provider,
        model: out.model,
        turns: attempt,
      };
    }

    steps.push({
      phase: "validate",
      status: "fail",
      attempt,
      detail: `Schema rejected the output: ${result.issues.join("; ")}`,
    });
    priorIssues = result.issues;
  }

  // The bound was reached without a schema-valid result (or maxTurns === 0, the
  // enforced zero bound: no attempt ran). The bound is the mechanism.
  throw new MaxTurnsError(opts.maxTurns, priorIssues);
}

/**
 * Extract a JSON object from a model's raw text. Real models (e.g. Claude on
 * Bedrock) fence JSON in ```json … ``` or add prose around it; this strips
 * fences and falls back to the first `{ … }` span. Returns `undefined` when no
 * parseable object is present — the validator turns that into a rejection.
 *
 * This is the "output extraction" the Phase 1A finding deferred to 2A.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  // Strip a leading/trailing Markdown code fence if present.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(body);
  if (direct !== undefined) return direct;

  // Fall back to the first balanced-looking `{ … }` span.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return tryParse(body.slice(start, end + 1));
  }
  return undefined;
}

/**
 * Build a {@link Validator} from a Zod schema. The schema IS the contract:
 * `jsonSchema` is derived from it (Zod → JSON Schema) for the executor to
 * target, and `validate` enforces it with a parse — schema-violating output is
 * rejected, never silently accepted (Phase 2A enforcement mechanism).
 */
export function zodValidator<T>(schema: z.ZodType<T>): Validator<T> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  return {
    jsonSchema,
    validate(rawOutput: string): ValidationResult<T> {
      const extracted = extractJsonObject(rawOutput);
      if (extracted === undefined) {
        return { ok: false, issues: ["output did not contain a parseable JSON object"] };
      }
      const parsed = schema.safeParse(extracted);
      if (parsed.success) {
        return { ok: true, value: parsed.data };
      }
      const issues = parsed.error.issues.map((i) => {
        const path = i.path.length > 0 ? i.path.join(".") : "(root)";
        return `${path}: ${i.message}`;
      });
      return { ok: false, issues };
    },
  };
}
