// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { EvalRunResult } from "./types.ts";

/**
 * The eval gate (Phase 1B): turn the suite into an enforcement mechanism. A run
 * is compared against a committed baseline **within the 1A tolerance band**, so
 * nondeterminism doesn't flake the gate while a real regression still fails it.
 * Pure and IO-free — the CLI loads the baseline file and reports the verdict.
 *
 * The CI gate runs against the deterministic `stub` provider (ADR 0003): the
 * baseline is exact, `--degraded` drops passing cases below the band, and the
 * build fails. A real-Bedrock job on `main` is added in Phase 2A.
 */

/** The slice of a baseline result the gate compares against. */
export interface GateBaseline {
  passed: number;
  total: number;
  passRate: number;
}

export interface GateOptions {
  /**
   * Allowed drop in passing cases before failing, expressed against the
   * baseline's full size (the 1A ±1 band → default 1). The comparison is on
   * **pass rate**, so a PR smoke run over a subset of cases is judged correctly
   * against the full-suite baseline instead of false-failing on raw counts.
   */
  toleranceCases?: number;
  /** Fail if the run's total USD exceeds this cap. 0/undefined = no cap. */
  maxUsd?: number;
}

// Float guard so an exactly-on-the-band run reads as within tolerance.
const EPSILON = 1e-9;

export interface GateVerdict {
  pass: boolean;
  /** Human-readable lines explaining the verdict (pass or fail). */
  reasons: string[];
  baseline: GateBaseline;
  current: { passed: number; total: number; passRate: number; totalUsd: number };
}

/** Extract the comparable baseline slice from a full committed result. */
export function baselineFromResult(result: EvalRunResult): GateBaseline {
  return {
    passed: result.summary.passed,
    total: result.summary.total,
    passRate: result.summary.passRate,
  };
}

/** Compare a run against a baseline within tolerance, plus an optional cost cap. */
export function evaluateGate(
  result: EvalRunResult,
  baseline: GateBaseline,
  opts: GateOptions = {},
): GateVerdict {
  const toleranceCases = opts.toleranceCases ?? 1;
  const { passed, total, passRate } = result.summary;
  const totalUsd = result.summary.cost.totalUsd;
  const reasons: string[] = [];
  let pass = true;

  // Regression check on pass RATE within the tolerance band. Expressing the
  // ±N-case band as a rate keeps it valid whether the run is the full suite or
  // a PR smoke subset.
  const rateTolerance = toleranceCases / Math.max(1, baseline.total);
  const rateFloor = baseline.passRate - rateTolerance;
  if (passRate < rateFloor - EPSILON) {
    pass = false;
    reasons.push(
      `REGRESSION: ${passed}/${total} passed (${(passRate * 100).toFixed(0)}%), below the ` +
        `baseline floor of ${(rateFloor * 100).toFixed(0)}% ` +
        `(baseline ${(baseline.passRate * 100).toFixed(0)}% − ${toleranceCases}/${baseline.total} band).`,
    );
  } else {
    reasons.push(
      `within tolerance: ${passed}/${total} passed (${(passRate * 100).toFixed(0)}%) vs ` +
        `baseline ${(baseline.passRate * 100).toFixed(0)}% (±${toleranceCases}/${baseline.total}).`,
    );
  }

  // Cost cap: bound spend so a misbehaving change can't burn unbounded budget.
  if (opts.maxUsd && opts.maxUsd > 0 && totalUsd > opts.maxUsd) {
    pass = false;
    reasons.push(
      `COST CAP: run cost $${totalUsd.toFixed(4)} exceeds cap $${opts.maxUsd.toFixed(4)}.`,
    );
  }

  return { pass, reasons, baseline, current: { passed, total, passRate, totalUsd } };
}
