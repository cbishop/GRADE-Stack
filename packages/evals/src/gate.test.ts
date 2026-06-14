// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/gate.test
 *
 * Tests for the eval gate — regression banding within the 1A tolerance, the
 * cost cap, and extraction of the comparable baseline slice.
 */

import { describe, expect, test } from "bun:test";
import { baselineFromResult, evaluateGate, type GateBaseline } from "./gate.ts";
import type { EvalRunResult } from "./types.ts";

/** Build a minimal EvalRunResult with the fields the gate reads. */
function result(passed: number, total: number, totalUsd = 0): EvalRunResult {
  return {
    provider: "stub",
    model: "stub-deterministic-v1",
    judgeProvider: "stub",
    timestamp: "2026-06-12T00:00:00.000Z",
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total === 0 ? 0 : passed / total,
      meanStability: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalUsd,
        usdPerSuccess: passed > 0 ? totalUsd / passed : null,
        tokensPerSuccess: passed > 0 ? 0 : null,
        price: { inputPerMTok: 0, outputPerMTok: 0 },
        basis: "free",
      },
    },
    cases: [],
  };
}

const BASELINE: GateBaseline = { passed: 12, total: 12, passRate: 1 };

describe("evaluateGate — regression", () => {
  test("a matching run passes", () => {
    expect(evaluateGate(result(12, 12), BASELINE).pass).toBe(true);
  });

  test("a one-case drop is within the default ±1 band", () => {
    expect(evaluateGate(result(11, 12), BASELINE).pass).toBe(true);
  });

  test("a two-case drop fails the gate", () => {
    const verdict = evaluateGate(result(10, 12), BASELINE);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("REGRESSION");
  });

  test("degraded-mode collapse (0/12) is blocked", () => {
    expect(evaluateGate(result(0, 12), BASELINE).pass).toBe(false);
  });

  test("a PR smoke subset (6/6) is judged on rate, not raw count, vs the full baseline", () => {
    // 6/6 = 100% must pass against a 12-case baseline (not fail as 6 < 11).
    expect(evaluateGate(result(6, 6), BASELINE).pass).toBe(true);
    // A failing case in the smoke subset still trips the gate.
    expect(evaluateGate(result(5, 6), BASELINE).pass).toBe(false);
  });
});

describe("evaluateGate — cost cap", () => {
  test("a run over the cap fails even if quality holds", () => {
    const verdict = evaluateGate(result(12, 12, 5.0), BASELINE, { maxUsd: 1.0 });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("COST CAP");
  });

  test("no cap by default", () => {
    expect(evaluateGate(result(12, 12, 100), BASELINE).pass).toBe(true);
  });
});

describe("baselineFromResult", () => {
  test("extracts the comparable slice", () => {
    expect(baselineFromResult(result(12, 12))).toEqual(BASELINE);
  });
});
