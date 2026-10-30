// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/types
 *
 * The eval result schema — planner/executor/validator phases, per-case traces,
 * and the run summary — shaped now to survive the Phase 2A agent refactor.
 * Phase 4C adds the release manifest that names the version a run measured.
 * Phase 4F adds where a run's outputs came from (`source`): the suite run live,
 * or captured production traffic re-scored, with the request id on every case.
 */

import type { ReleaseManifest, TokenUsage } from "@grade-stack/core";
import type { CostBreakdown } from "./pricing.ts";

/**
 * The planner / executor / validator phases. The reference agent is naive in
 * Phase 1A (only the executor actually runs), but the eval schema is shaped
 * around all three phases now so it survives the Phase 2A refactor that makes
 * planner and validator explicit. Each eval case records per-step outcomes
 * along this path, not just a final pass/fail.
 */
export type Phase = "plan" | "execute" | "validate";

export const PHASES: readonly Phase[] = ["plan", "execute", "validate"] as const;

/** Status of a single phase for one eval case. */
export type StepStatus = "ok" | "fail" | "skipped";

/**
 * One step of the planner/executor/validator trace for a single eval case.
 * `checks` are the individual assertions that rolled up into this step's status.
 */
export interface TraceStep {
  phase: Phase;
  status: StepStatus;
  checks: TraceCheck[];
}

/** A single assertion result, attributed to a phase via its metric prefix. */
export interface TraceCheck {
  /** The promptfoo metric name, e.g. "validate:json-valid". */
  metric: string;
  pass: boolean;
  score: number;
  reason?: string;
}

/** Per-case result, including the phase-attributed trace. */
export interface CaseResult {
  id: string;
  description: string;
  /** True only if every check passed. */
  pass: boolean;
  /** Aggregate score in [0, 1]. */
  score: number;
  trace: TraceStep[];
  /** The agent's raw output for this case (last repeat). */
  output: string;
  /** Per-provider token usage summed across repeats. */
  usage: TokenUsage;
  /**
   * Flakiness across `repeat` runs: the fraction of repeats whose pass/fail
   * matched the majority outcome. 1.0 means perfectly stable.
   */
  stability: number;
  /** Number of repeats this case was run. */
  repeats: number;
  /**
   * The gateway request id this case was captured under (Phase 4F, re-scored
   * traces only), so a failing production run joins its decision-log line,
   * its trace and any review item.
   */
  requestId?: string;
  /** The caller the captured request came from (re-scored traces only). */
  callerId?: string | null;
}

/** Where a result's outputs came from (Phase 4F). Absent means `suite`. */
export type EvalSource = "suite" | "traces";

/** A capture file `--from-traces` did not re-score, and why. */
export interface TraceSkip {
  file: string;
  requestId: string | null;
  reason: string;
}

/** What a trace re-score read (Phase 4F, `source: "traces"` only). */
export interface TraceProvenance {
  /** The 4B capture directory that was re-scored. */
  dir: string;
  /** Capture files found. */
  captures: number;
  /** Captured triage answers re-scored (one case each). */
  rescored: number;
  skipped: TraceSkip[];
  /** Capture time of the earliest and latest re-scored request. */
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
}

/** The structured JSON emitted by `reliability eval run`. */
export interface EvalRunResult {
  /** Which model provider backed the agent under test. */
  provider: string;
  /** The agent model id (used for cost pricing). */
  model: string;
  /** Which model provider backed the LLM-as-judge metrics. */
  judgeProvider: string;
  /** ISO timestamp, stamped by the CLI after the run completes. */
  timestamp: string;
  summary: EvalSummary;
  cases: CaseResult[];
  /**
   * The release this run measured (Phase 4C, ADR 0018): git state, prompt hash,
   * model, provider, tools and policy hash. Optional only because results
   * written before 4C lack it; every new run stamps one.
   */
  release?: ReleaseManifest;
  /**
   * `suite` for a live run of the suite, `traces` for captured production
   * outputs re-scored by `eval run --from-traces` (Phase 4F). Results written
   * before 4F lack it and are suite runs.
   */
  source?: EvalSource;
  /** What a trace re-score read; present only when `source` is `traces`. */
  traces?: TraceProvenance;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  /** Mean per-case stability across the suite (flakiness signal). */
  meanStability: number;
  usage: TokenUsage;
  /** Cost-per-success and the dollar/token breakdown behind it (Phase 1B). */
  cost: CostBreakdown;
}
