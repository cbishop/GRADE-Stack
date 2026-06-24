// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/scorecard.test
 *
 * Tests for buildScorecard — dimension structure, honest stubbing, purity, the
 * reliability/cost bands, the worst-wins rollup, and honest degradation.
 */

import { describe, expect, test } from "bun:test";
import type { TraceCoverage } from "@grade-stack/core";
import { type CaseResult, computeCost, type EvalRunResult } from "@grade-stack/evals";
import type { GuardrailCoverage } from "./owasp.ts";
import { buildScorecard } from "./scorecard.ts";
import type { Dimension, Scorecard } from "./types.ts";
import { RATING_RANK } from "./types.ts";

const PER_CASE_TOKENS = { inputTokens: 100, outputTokens: 30 };

/** Build a deterministic eval result with `passed` of `total` cases passing. */
function makeResult(
  passed: number,
  total: number,
  opts: { provider?: string; model?: string; stability?: number } = {},
): EvalRunResult {
  const provider = opts.provider ?? "bedrock";
  const model = opts.model ?? "claude-haiku-4-5";
  const stability = opts.stability ?? 1;

  const cases: CaseResult[] = Array.from({ length: total }, (_, i) => ({
    id: `case-${i}`,
    description: `case-${i}`,
    pass: i < passed,
    score: i < passed ? 1 : 0,
    trace: [],
    output: "{}",
    usage: { ...PER_CASE_TOKENS },
    stability,
    repeats: 1,
  }));

  const usage = {
    inputTokens: PER_CASE_TOKENS.inputTokens * total,
    outputTokens: PER_CASE_TOKENS.outputTokens * total,
  };

  return {
    provider,
    model,
    judgeProvider: provider,
    timestamp: "2026-06-13T00:00:00.000Z",
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: total === 0 ? 0 : passed / total,
      meanStability: stability,
      usage,
      cost: computeCost(provider, model, usage, passed),
    },
    cases,
  };
}

/** Fetch a dimension by key (throws if absent — keeps the tests total-access-safe). */
function dim(card: Scorecard, key: string): Dimension {
  const d = card.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`scorecard has no dimension "${key}"`);
  return d;
}

const reliability = (passed: number, total: number, stability?: number): Dimension =>
  dim(buildScorecard(makeResult(passed, total, { stability })), "reliability");

const costDiscipline = (
  passed: number,
  total: number,
  provider?: string,
  model?: string,
): Dimension =>
  dim(buildScorecard(makeResult(passed, total, { provider, model })), "cost-discipline");

describe("buildScorecard — structure", () => {
  test("has five dimensions; only Reliability and Cost discipline are assessed in 1C", () => {
    const card = buildScorecard(makeResult(12, 12));
    expect(card.dimensions).toHaveLength(5);
    expect(card.meta.assessedCount).toBe(2);
    expect(card.meta.totalDimensions).toBe(5);

    const assessed = card.dimensions.filter((d) => d.assessed).map((d) => d.key);
    expect(assessed).toEqual(["reliability", "cost-discipline"]);
  });

  test("stubbed dimensions are honest: not-assessed, no asserted score, name their phase", () => {
    const card = buildScorecard(makeResult(12, 12));
    for (const key of ["observability", "guardrails", "governance"]) {
      const d = dim(card, key);
      expect(d.assessed).toBe(false);
      expect(d.rating).toBe("not-assessed");
      expect(d.plannedPhase ?? "").toMatch(/Phase \d/);
    }
  });

  test("is pure — carries the eval timestamp rather than reading the clock", () => {
    const result = makeResult(10, 12);
    const a = buildScorecard(result);
    const b = buildScorecard(result);
    expect(a.generatedAt).toBe(result.timestamp);
    expect(a).toEqual(b);
  });

  test("every assessed rating is backed by at least one line of evidence", () => {
    const card = buildScorecard(makeResult(8, 12));
    for (const d of card.dimensions.filter((x) => x.assessed)) {
      expect(d.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("Reliability dimension", () => {
  test("all passing → Strong", () => {
    const d = reliability(12, 12);
    expect(d.rating).toBe("strong");
    expect(d.evidence.join(" ")).toContain("12 of 12");
  });

  test("bands track the pass rate", () => {
    expect(reliability(10, 12).rating).toBe("adequate"); // 0.83
    expect(reliability(7, 12).rating).toBe("at-risk"); // 0.58
    expect(reliability(3, 12).rating).toBe("critical"); // 0.25
  });

  test("flakiness below the floor knocks the rating down one band", () => {
    const stable = reliability(12, 12, 1);
    const flaky = reliability(12, 12, 0.6);
    expect(stable.rating).toBe("strong");
    expect(flaky.rating).toBe("adequate"); // downgraded one band
    expect(flaky.evidence.join(" ")).toContain("held back one band");
  });

  test("lists failing case ids as evidence (capped)", () => {
    const line = reliability(2, 12).evidence.find((e) => e.startsWith("Failing cases:"));
    expect(line ?? "").toContain("more"); // capped with a "+N more" tail
  });
});

describe("Cost discipline dimension", () => {
  test("no waste → Strong; cost-per-success reported", () => {
    const d = costDiscipline(12, 12);
    expect(d.rating).toBe("strong");
    expect(d.evidence.join(" ")).toContain("0% of spend produced no passing result");
  });

  test("waste fraction drives the band", () => {
    // 10/12 → ~17% waste (adequate); 7/12 → ~42% (at-risk).
    expect(costDiscipline(10, 12).rating).toBe("adequate");
    expect(costDiscipline(7, 12).rating).toBe("at-risk");
  });

  test("nothing passes → Critical, cost-per-success undefined", () => {
    const d = costDiscipline(0, 12);
    expect(d.rating).toBe("critical");
    expect(d.evidence.join(" ")).toContain("undefined");
    expect(d.evidence.join(" ")).toContain("100% of spend");
  });

  test("Ollama free provider reports tokens-per-success, not dollars", () => {
    const d = costDiscipline(12, 12, "ollama", "llama3.1");
    expect(d.evidence.join(" ")).toContain("tokens");
    expect(d.evidence.join(" ")).toContain("$0");
  });
});

describe("Overall verdict", () => {
  test("is the worst assessed band (worst-wins)", () => {
    // 7/12: adequate reliability, at-risk cost → at-risk overall.
    const card = buildScorecard(makeResult(7, 12));
    expect(card.overall.rating).toBe("at-risk");
  });
});

describe("honest degradation (acceptance criterion)", () => {
  test("a degraded (zero-pass) run earns a strictly worse scorecard than a healthy one", () => {
    const healthy = buildScorecard(makeResult(12, 12));
    const degraded = buildScorecard(makeResult(0, 12), { degraded: true });

    expect(RATING_RANK.strong).toBeGreaterThan(RATING_RANK.critical);
    expect(healthy.overall.rating).toBe("strong");
    expect(degraded.overall.rating).toBe("critical");
    expect(degraded.degraded).toBe(true);
    // Both computed dimensions degrade, not just one.
    expect(dim(degraded, "reliability").rating).toBe("critical");
    expect(dim(degraded, "cost-discipline").rating).toBe("critical");
  });

  test("the degraded flag is cosmetic only — it never lifts or lowers a rating", () => {
    const withFlag = buildScorecard(makeResult(12, 12), { degraded: true });
    const without = buildScorecard(makeResult(12, 12), { degraded: false });
    expect(withFlag.dimensions.map((d) => d.rating)).toEqual(
      without.dimensions.map((d) => d.rating),
    );
    expect(withFlag.overall.rating).toBe(without.overall.rating);
  });
});

/** A trace-coverage fixture; defaults describe a healthy connected full-path trace. */
function cov(p: Partial<TraceCoverage> = {}): TraceCoverage {
  return {
    totalSpans: p.totalSpans ?? 5,
    rootSpans: p.rootSpans ?? 1,
    distinctTraces: p.distinctTraces ?? 1,
    connected: p.connected ?? true,
    observedPhases: p.observedPhases ?? ["plan", "execute", "validate"],
    missingPhases: p.missingPhases ?? [],
    phaseCoverage: p.phaseCoverage ?? 1,
    modelCallSpans: p.modelCallSpans ?? 1,
    toolCallSpans: p.toolCallSpans ?? 0,
  };
}

describe("Observability dimension (Phase 2D)", () => {
  test("stays a not-assessed stub when no coverage is supplied", () => {
    const d = dim(buildScorecard(makeResult(12, 12)), "observability");
    expect(d.assessed).toBe(false);
    expect(d.rating).toBe("not-assessed");
  });

  test("a connected full-path trace earns Strong, traced to span evidence", () => {
    const card = buildScorecard(makeResult(12, 12), { observability: cov() });
    const d = dim(card, "observability");
    expect(d.assessed).toBe(true);
    expect(d.rating).toBe("strong");
    expect(d.evidence.join(" ")).toContain("connected trace");
    expect(card.meta.assessedCount).toBe(3);
  });

  test("bands track coverage: fragmented → At risk, no spans → Critical", () => {
    expect(
      dim(
        buildScorecard(makeResult(12, 12), {
          observability: cov({ connected: false, rootSpans: 2, distinctTraces: 2 }),
        }),
        "observability",
      ).rating,
    ).toBe("at-risk");

    expect(
      dim(
        buildScorecard(makeResult(12, 12), {
          observability: cov({
            totalSpans: 0,
            rootSpans: 0,
            connected: false,
            observedPhases: [],
            missingPhases: ["plan", "execute", "validate"],
            phaseCoverage: 0,
            modelCallSpans: 0,
          }),
        }),
        "observability",
      ).rating,
    ).toBe("critical");
  });

  test("partial phase coverage on a connected trace is Adequate, not Strong", () => {
    const d = dim(
      buildScorecard(makeResult(12, 12), {
        observability: cov({
          observedPhases: ["plan", "execute"],
          missingPhases: ["validate"],
          phaseCoverage: 2 / 3,
        }),
      }),
      "observability",
    );
    expect(d.rating).toBe("adequate");
    expect(d.evidence.join(" ")).toContain("validate");
  });

  test("observability is independent of degraded mode (the path is still traced)", () => {
    const healthy = dim(
      buildScorecard(makeResult(12, 12), { observability: cov() }),
      "observability",
    );
    const degraded = dim(
      buildScorecard(makeResult(0, 12), { degraded: true, observability: cov() }),
      "observability",
    );
    expect(healthy.rating).toBe("strong");
    expect(degraded.rating).toBe("strong");
  });
});

/** A guardrail-coverage fixture; defaults describe near-complete OWASP coverage. */
function guard(p: Partial<GuardrailCoverage> = {}): GuardrailCoverage {
  return {
    taxonomy: p.taxonomy ?? "OWASP Top 10 for Agentic Applications",
    version: p.version ?? "2026",
    publishedAt: p.publishedAt ?? "2025-12-09",
    sourceUrl: p.sourceUrl ?? "https://genai.owasp.org/",
    total: p.total ?? 10,
    covered: p.covered ?? 9,
    partial: p.partial ?? 1,
    gaps: p.gaps ?? 0,
    score: p.score ?? 0.95,
    gapIds: p.gapIds ?? [],
    partialIds: p.partialIds ?? ["ASI09:2026"],
  };
}

describe("Guardrail dimension (Phase 3A)", () => {
  test("stays a not-assessed stub when no coverage is supplied", () => {
    const d = dim(buildScorecard(makeResult(12, 12)), "guardrails");
    expect(d.assessed).toBe(false);
    expect(d.rating).toBe("not-assessed");
  });

  test("bands track the weighted OWASP coverage score", () => {
    const rating = (score: number) =>
      dim(buildScorecard(makeResult(12, 12), { guardrails: guard({ score }) }), "guardrails")
        .rating;
    expect(rating(0.95)).toBe("strong");
    expect(rating(0.8)).toBe("adequate");
    expect(rating(0.5)).toBe("at-risk");
    expect(rating(0.3)).toBe("critical");
  });

  test("cites the OWASP edition and names every flagged gap in the evidence", () => {
    const card = buildScorecard(makeResult(12, 12), {
      guardrails: guard({
        score: 0.5,
        covered: 2,
        partial: 6,
        gaps: 2,
        gapIds: ["ASI06:2026", "ASI07:2026"],
        partialIds: ["ASI01:2026"],
      }),
    });
    const d = dim(card, "guardrails");
    expect(d.assessed).toBe(true);
    expect(d.rating).toBe("at-risk");
    const text = d.evidence.join(" ");
    expect(text).toContain("2026");
    expect(text).toContain("ASI06:2026");
    expect(text).toContain("ASI07:2026");
    // Lighting up guardrails alongside observability brings the count to four.
    expect(
      buildScorecard(makeResult(12, 12), { guardrails: guard(), observability: cov() }).meta
        .assessedCount,
    ).toBe(4);
  });

  test("guardrail coverage is independent of degraded mode (it rates the stack, not the run)", () => {
    const healthy = dim(buildScorecard(makeResult(12, 12), { guardrails: guard() }), "guardrails");
    const degraded = dim(
      buildScorecard(makeResult(0, 12), { degraded: true, guardrails: guard() }),
      "guardrails",
    );
    expect(healthy.rating).toBe(degraded.rating);
  });
});
