// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { GenerateResult, ModelProvider, TokenUsage } from "@grade-stack/core";
import type { SupportEmail } from "./sample-email.ts";

export interface TriageResult {
  /** The model's raw, unvalidated output. Parsing/validation is intentionally absent. */
  raw: string;
  usage: TokenUsage;
  provider: string;
  model: string;
  /** How many model turns the agent took (bounded by maxTurns). */
  turns: number;
  /** Whether degraded mode deliberately worsened the output. */
  degraded: boolean;
}

/** Default upper bound on model turns. A naive single-call agent uses 1; the
 * bound exists so the Phase 2A planner/executor/validator loop can't run away. */
export const DEFAULT_MAX_TURNS = 4;

export interface RunAgentOptions {
  /**
   * Hard upper bound on model turns. **Enforced**, not suggested: if the agent
   * fails to converge within this many turns it throws {@link MaxTurnsError}
   * rather than looping. Defaults to RELIABILITY_MAX_TURNS, then
   * {@link DEFAULT_MAX_TURNS}.
   */
  maxTurns?: number;
  /**
   * Deliberately worsen the agent's output (drops the structured contract) so
   * the eval gate has a regression to catch. Defaults to RELIABILITY_DEGRADED.
   * Kept permanently as a gate canary (Phase 1B).
   */
  degraded?: boolean;
}

/** Thrown when the reference agent hits its turn bound without converging. */
export class MaxTurnsError extends Error {
  constructor(readonly maxTurns: number) {
    super(`Reference agent exceeded its turn bound of ${maxTurns} without converging.`);
    this.name = "MaxTurnsError";
  }
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
 * blocking a bad PR and retained as a permanent canary.
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

const SYSTEM_PROMPT = [
  "You are a customer-support triage assistant.",
  "Given one inbound support email, return a single JSON object with exactly these fields:",
  '  "category"     — one of: billing, technical, account, other',
  '  "priority"     — one of: low, medium, high, urgent',
  '  "sentiment"    — one of: positive, neutral, negative',
  '  "summary"      — one sentence describing the issue',
  '  "draft_reply"  — a short, professional reply to the customer',
  "Respond with only the JSON object and nothing else.",
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

/**
 * The naive Phase 0 reference agent: one model call, no validation, no retries,
 * no tools. This is the deliberate "before" state that later phases measure and
 * improve. It runs identically against any {@link ModelProvider}.
 *
 * The single call is wrapped in a **bounded** turn loop. The naive agent
 * converges in one turn; the bound exists so the Phase 2A planner/executor/
 * validator loop is structurally prevented from running away — exceed it and
 * the agent throws {@link MaxTurnsError} (Phase 1B: enforced, not suggested).
 */
export async function runReferenceAgent(
  provider: ModelProvider,
  email: SupportEmail,
  opts: RunAgentOptions = {},
): Promise<TriageResult> {
  const maxTurns = resolveMaxTurns(opts.maxTurns);
  const degraded = resolveDegraded(opts.degraded);

  let turns = 0;
  let result: GenerateResult | undefined;
  let converged = false;

  while (turns < maxTurns) {
    turns += 1;
    result = await provider.generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderUserPrompt(email) }],
      maxTokens: 800,
      temperature: 0,
    });
    // The naive agent has no planner/validator loop yet, so one turn always
    // converges. Phase 2A replaces this with a real loop that may re-plan.
    converged = true;
    break;
  }

  if (!converged || result === undefined) {
    // The bound was reached before the agent produced a usable result.
    throw new MaxTurnsError(maxTurns);
  }

  return {
    raw: degraded ? degrade(result.text) : result.text,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
    turns,
    degraded,
  };
}
