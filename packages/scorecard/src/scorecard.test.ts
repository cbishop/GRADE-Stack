// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/scorecard.test
 *
 * Tests for buildScorecard: the five GRADE-letter dimensions (ADR 0016), the
 * computed/stubbed two-state criterion rule (no third state), purity, the
 * per-criterion bands, the worst-wins rollups, and honest degradation.
 */

import { describe, expect, test } from "bun:test";
import type { TraceCoverage } from "@grade-stack/core";
import { type CaseResult, computeCost, type EvalRunResult } from "@grade-stack/evals";
import type { GovernanceReadiness } from "./eu-ai-act.ts";
import type { GuardrailCoverage } from "./owasp.ts";
import { buildScorecard, parseRetentionPeriod, type ScorecardOptions } from "./scorecard.ts";
import type {
  Criterion,
  DecisionLogEntry,
  DecisionLogEvidence,
  Dimension,
  DimensionId,
  Scorecard,
} from "./types.ts";
import { FILLS_IN_PHASES, GRADE_DIMENSION_IDS, RATING_RANK } from "./types.ts";

const PER_CASE_TOKENS = { inputTokens: 100, outputTokens: 30 };

/**
 * Build a deterministic eval result with `passed` of `total` cases passing. By
 * default the suite has the breadth the E criterion looks for (a refusal case
 * and a judge metric); `breadth: false` strips both.
 */
function makeResult(
  passed: number,
  total: number,
  opts: { provider?: string; model?: string; stability?: number; breadth?: boolean } = {},
): EvalRunResult {
  const provider = opts.provider ?? "bedrock";
  const model = opts.model ?? "claude-haiku-4-5";
  const stability = opts.stability ?? 1;
  const breadth = opts.breadth ?? true;

  const cases: CaseResult[] = Array.from({ length: total }, (_, i) => {
    const id = breadth && i === total - 1 ? "refusal-data-exfiltration" : `case-${i}`;
    const pass = i < passed;
    return {
      id,
      description: id,
      pass,
      score: pass ? 1 : 0,
      trace: breadth
        ? [
            {
              phase: "validate" as const,
              status: pass ? ("ok" as const) : ("fail" as const),
              checks: [{ metric: "validate:judge", pass, score: pass ? 1 : 0 }],
            },
          ]
        : [],
      output: "{}",
      usage: { ...PER_CASE_TOKENS },
      stability,
      repeats: 1,
    };
  });

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

/** A guardrail-coverage fixture; defaults describe near-complete OWASP coverage. */
function guard(p: Partial<GuardrailCoverage> = {}): GuardrailCoverage {
  return {
    taxonomy: p.taxonomy ?? "OWASP Top 10 for Agentic Applications",
    version: p.version ?? "2026",
    publishedAt: p.publishedAt ?? "2025-12-09",
    sourceUrl: p.sourceUrl ?? "https://genai.owasp.org/",
    total: p.total ?? 10,
    scoredCount: p.scoredCount ?? 10,
    covered: p.covered ?? 9,
    partial: p.partial ?? 1,
    gaps: p.gaps ?? 0,
    outOfScope: p.outOfScope ?? 0,
    score: p.score ?? 0.95,
    gapIds: p.gapIds ?? [],
    partialIds: p.partialIds ?? ["ASI09:2026"],
    outOfScopeIds: p.outOfScopeIds ?? [],
  };
}

/** A governance-readiness fixture; defaults describe a strong module. */
function gov(p: Partial<GovernanceReadiness> = {}): GovernanceReadiness {
  return {
    framework: p.framework ?? "EU Artificial Intelligence Act",
    regulation: p.regulation ?? "Regulation (EU) 2024/1689",
    retrievedAt: p.retrievedAt ?? "2026-06-24",
    sourceUrl: p.sourceUrl ?? "https://artificialintelligenceact.eu/",
    omnibusStage: p.omnibusStage ?? "Provisional agreement; not yet adopted.",
    total: p.total ?? 10,
    scoredCount: p.scoredCount ?? 6,
    supported: p.supported ?? 6,
    partial: p.partial ?? 0,
    deployerOwned: p.deployerOwned ?? 0,
    score: p.score ?? 0.95,
    inForceNowIds: p.inForceNowIds ?? ["Art 5", "Art 4", "Art 50 (1)(4)"],
    deployerOwnedIds: p.deployerOwnedIds ?? [],
  };
}

/** Build a scorecard with healthy defaults for every evidence input. */
function card(
  result: EvalRunResult = makeResult(12, 12),
  over: Partial<ScorecardOptions> = {},
): Scorecard {
  return buildScorecard(result, {
    observability: cov(),
    guardrails: guard(),
    governance: gov(),
    ...over,
  });
}

/** Fetch a dimension by id (throws if absent, so the tests stay total-access-safe). */
function dim(c: Scorecard, id: DimensionId): Dimension {
  const d = c.dimensions.find((x) => x.id === id);
  if (!d) throw new Error(`scorecard has no dimension "${id}"`);
  return d;
}

/** Fetch a criterion by key from any dimension (throws if absent). */
function crit(c: Scorecard, key: string): Criterion {
  for (const d of c.dimensions) {
    const found = d.criteria.find((x) => x.key === key);
    if (found) return found;
  }
  throw new Error(`scorecard has no criterion "${key}"`);
}

/** Evidence lines of a criterion joined, or "" for a stub. */
const text = (x: Criterion): string => (x.state === "computed" ? x.evidence.join(" ") : "");

const reliability = (passed: number, total: number, stability?: number): Criterion =>
  crit(card(makeResult(passed, total, { stability })), "reliability");

const costDiscipline = (
  passed: number,
  total: number,
  provider?: string,
  model?: string,
): Criterion => crit(card(makeResult(passed, total, { provider, model })), "cost-discipline");

describe("GRADE-letter dimensions (Phase 4A, ADR 0016)", () => {
  test("the five dimension ids are exactly governed, reliable, agentic, deployed, evaluated, in order", () => {
    const c = card();
    expect(c.dimensions.map((d) => d.id)).toEqual([
      "governed",
      "reliable",
      "agentic",
      "deployed",
      "evaluated",
    ]);
    expect([...GRADE_DIMENSION_IDS]).toEqual(c.dimensions.map((d) => d.id));
    expect(c.dimensions.map((d) => d.letter)).toEqual(["G", "R", "A", "D", "E"]);
    expect(c.dimensions.map((d) => d.title)).toEqual([
      "Governed",
      "Reliable",
      "Agentic",
      "Deployed",
      "Evaluated",
    ]);
  });

  test("each dimension holds named criteria, mapped per ADR 0016", () => {
    const c = card();
    const keys = (id: DimensionId) => dim(c, id).criteria.map((x) => x.key);
    expect(keys("governed")).toEqual(["governance", "human-oversight", "boundary-register"]);
    expect(keys("reliable")).toEqual(["reliability", "cost-discipline"]);
    expect(keys("agentic")).toEqual(["guardrails", "autonomy-scope"]);
    expect(keys("deployed")).toEqual([
      "observability",
      "attributable",
      "reconstructable",
      "rollback",
    ]);
    expect(keys("evaluated")).toEqual([
      "suite-breadth",
      "real-model-freshness",
      "judge-calibration",
      "post-deployment-rescore",
    ]);
    for (const d of c.dimensions) {
      expect(d.criteria.length).toBeGreaterThan(0);
      for (const x of d.criteria) expect(x.title.length).toBeGreaterThan(0);
    }
  });

  test("every criterion is computed-with-citation or stubbed-with-fillsIn; there is no third state", () => {
    // Register row: "Scorecard cannot claim a letter it has no evidence for".
    for (const c of [card(), card(makeResult(0, 12), { degraded: true })]) {
      for (const d of c.dimensions) {
        for (const x of d.criteria) {
          expect(["computed", "stubbed"]).toContain(x.state);
          if (x.state === "computed") {
            expect(x.rating).not.toBe("not-assessed");
            expect(x.evidence.length).toBeGreaterThan(0);
            expect(x.citation.source.length).toBeGreaterThan(0);
            expect(x.citation.threshold.length).toBeGreaterThan(0);
            expect(x.citation.wouldChange.length).toBeGreaterThan(0);
            expect("fillsIn" in x).toBe(false);
          } else {
            expect(x.rating).toBe("not-assessed");
            expect(FILLS_IN_PHASES as readonly string[]).toContain(x.fillsIn);
            expect(x.computedFrom.length).toBeGreaterThan(0);
            expect("citation" in x).toBe(false);
            expect("evidence" in x).toBe(false);
          }
        }
      }
    }
  });

  test("every stubbed criterion names a fillsIn sub-phase in 4B to 4F", () => {
    const c = card();
    const stubs = c.dimensions.flatMap((d) => d.criteria).filter((x) => x.state === "stubbed");
    expect(stubs.length).toBe(9);
    for (const x of stubs) {
      expect(["4B", "4C", "4D", "4E", "4F"]).toContain(x.state === "stubbed" ? x.fillsIn : "");
    }
    expect(crit(c, "human-oversight")).toMatchObject({ state: "stubbed", fillsIn: "4D" });
    expect(crit(c, "boundary-register")).toMatchObject({ state: "stubbed", fillsIn: "4E" });
    expect(crit(c, "autonomy-scope")).toMatchObject({ state: "stubbed", fillsIn: "4E" });
    expect(crit(c, "attributable")).toMatchObject({ state: "stubbed", fillsIn: "4B" });
    expect(crit(c, "reconstructable")).toMatchObject({ state: "stubbed", fillsIn: "4B" });
    expect(crit(c, "rollback")).toMatchObject({ state: "stubbed", fillsIn: "4C" });
    for (const k of ["real-model-freshness", "judge-calibration", "post-deployment-rescore"]) {
      expect(crit(c, k)).toMatchObject({ state: "stubbed", fillsIn: "4F" });
    }
  });

  test("a dimension's grade is its weakest computed criterion; stubs never move it", () => {
    // 7/12: Reliability at-risk (58%), Cost at-risk (~42% waste), so R is at-risk.
    expect(dim(card(makeResult(7, 12)), "reliable").rating).toBe("at-risk");
    // 10/12 and flaky: Reliability held back to at-risk, Cost adequate, so R is at-risk.
    const flaky = card(makeResult(10, 12, { stability: 0.6 }));
    expect(crit(flaky, "cost-discipline").rating).toBe("adequate");
    expect(crit(flaky, "reliability").rating).toBe("at-risk");
    expect(dim(flaky, "reliable").rating).toBe("at-risk");
    // G holds one computed criterion and two stubs: its grade is the computed one.
    expect(dim(card(), "governed").rating).toBe("strong");
    for (const d of card().dimensions) expect(d.assessed).toBe(true);
  });

  test("meta counts graded letters and computed vs stubbed criteria", () => {
    expect(card().meta).toEqual({
      assessedCount: 5,
      totalDimensions: 5,
      computedCriteria: 6,
      stubbedCriteria: 9,
    });
  });

  test("is pure: carries the eval timestamp rather than reading the clock", () => {
    const result = makeResult(10, 12);
    const a = card(result);
    const b = card(result);
    expect(a.generatedAt).toBe(result.timestamp);
    expect(a).toEqual(b);
  });

  test("the results source label is cited by the run-derived criteria", () => {
    const c = card(makeResult(12, 12), { resultsSource: "content/cycle-12/eval-run.json" });
    for (const k of ["reliability", "cost-discipline", "suite-breadth"]) {
      const x = crit(c, k);
      expect(x.state === "computed" ? x.citation.source : "").toContain(
        "content/cycle-12/eval-run.json",
      );
    }
  });
});

describe("Overall verdict", () => {
  test("is the weakest dimension (worst-wins) and names it by letter", () => {
    // 7/12: R at-risk, every other letter strong, so the verdict is at-risk, driven by R.
    const c = card(makeResult(7, 12));
    expect(c.overall.rating).toBe("at-risk");
    expect(c.overall.headline).toContain("R · Reliable");
  });

  test("names Governed when governance readiness is the weakest", () => {
    const c = card(makeResult(12, 12), { governance: gov({ score: 0.58 }) });
    expect(c.overall.rating).toBe("at-risk");
    expect(c.overall.headline).toContain("G · Governed");
  });

  test("all strong reads production-ready on the evidence, with stubs still counted", () => {
    const c = card();
    expect(c.overall.rating).toBe("strong");
    expect(c.overall.headline).toContain("9 criteria");
  });
});

describe("Reliability criterion (R)", () => {
  test("all passing -> Strong", () => {
    const x = reliability(12, 12);
    expect(x.rating).toBe("strong");
    expect(text(x)).toContain("12 of 12");
  });

  test("bands track the pass rate", () => {
    expect(reliability(10, 12).rating).toBe("adequate"); // 0.83
    expect(reliability(7, 12).rating).toBe("at-risk"); // 0.58
    expect(reliability(3, 12).rating).toBe("critical"); // 0.25
  });

  test("flakiness below the floor knocks the rating down one band", () => {
    expect(reliability(12, 12, 1).rating).toBe("strong");
    const flaky = reliability(12, 12, 0.6);
    expect(flaky.rating).toBe("adequate");
    expect(text(flaky)).toContain("held back one band");
  });

  test("lists failing case ids as evidence (capped)", () => {
    const x = reliability(2, 12);
    const line = (x.state === "computed" ? x.evidence : []).find((e) =>
      e.startsWith("Failing cases:"),
    );
    expect(line ?? "").toContain("more");
  });
});

describe("Cost discipline criterion (R)", () => {
  test("no waste -> Strong; cost-per-success reported", () => {
    const x = costDiscipline(12, 12);
    expect(x.rating).toBe("strong");
    expect(text(x)).toContain("0% of spend produced no passing result");
  });

  test("waste fraction drives the band", () => {
    expect(costDiscipline(10, 12).rating).toBe("adequate");
    expect(costDiscipline(7, 12).rating).toBe("at-risk");
  });

  test("nothing passes -> Critical, cost-per-success undefined", () => {
    const x = costDiscipline(0, 12);
    expect(x.rating).toBe("critical");
    expect(text(x)).toContain("undefined");
    expect(text(x)).toContain("100% of spend");
  });

  test("Ollama free provider reports tokens-per-success, not dollars", () => {
    const x = costDiscipline(12, 12, "ollama", "llama3.1");
    expect(text(x)).toContain("tokens");
    expect(text(x)).toContain("$0");
  });
});

describe("honest degradation (acceptance criterion)", () => {
  test("degraded mode still drops R, and the overall verdict with it", () => {
    const healthy = card(makeResult(12, 12));
    const degraded = card(makeResult(0, 12), { degraded: true });

    expect(RATING_RANK.strong).toBeGreaterThan(RATING_RANK.critical);
    expect(dim(healthy, "reliable").rating).toBe("strong");
    expect(dim(degraded, "reliable").rating).toBe("critical");
    expect(crit(degraded, "reliability").rating).toBe("critical");
    expect(crit(degraded, "cost-discipline").rating).toBe("critical");
    expect(healthy.overall.rating).toBe("strong");
    expect(degraded.overall.rating).toBe("critical");
    expect(degraded.overall.headline).toContain("R · Reliable");
    expect(degraded.degraded).toBe(true);
  });

  test("the degraded flag is cosmetic only: it never lifts or lowers a rating", () => {
    const withFlag = card(makeResult(12, 12), { degraded: true });
    const without = card(makeResult(12, 12), { degraded: false });
    expect(withFlag.dimensions.map((d) => d.rating)).toEqual(
      without.dimensions.map((d) => d.rating),
    );
    expect(withFlag.overall.rating).toBe(without.overall.rating);
  });

  test("mechanism-property letters (G, A, D) are independent of degraded mode", () => {
    const healthy = card(makeResult(12, 12));
    const degraded = card(makeResult(0, 12), { degraded: true });
    for (const id of ["governed", "agentic", "deployed"] as const) {
      expect(dim(degraded, id).rating).toBe(dim(healthy, id).rating);
    }
  });
});

describe("Suite breadth criterion (E)", () => {
  const breadth = (result: EvalRunResult) => crit(card(result), "suite-breadth");

  test("10+ cases, a refusal or OOD case, and a judge metric -> Strong", () => {
    const x = breadth(makeResult(12, 12));
    expect(x.state).toBe("computed");
    expect(x.rating).toBe("strong");
  });

  test("an OOD case counts the same as a refusal case", () => {
    const r = makeResult(12, 12);
    const last = r.cases[r.cases.length - 1];
    if (last) {
      last.id = "ood-off-topic";
      last.description = "ood-off-topic";
    }
    expect(breadth(r).rating).toBe("strong");
  });

  test("missing one of the three checks -> At risk; missing more -> Critical", () => {
    expect(breadth(makeResult(9, 9)).rating).toBe("at-risk"); // fewer than 10 cases
    expect(breadth(makeResult(12, 12, { breadth: false })).rating).toBe("critical");
    expect(breadth(makeResult(5, 5, { breadth: false })).rating).toBe("critical");
  });

  test("names each missing check in the evidence", () => {
    const t = text(breadth(makeResult(12, 12, { breadth: false })));
    expect(t).toContain("refusal");
    expect(t).toContain("judge");
  });
});

describe("Observability coverage criterion (D)", () => {
  const obs = (c: TraceCoverage) =>
    crit(card(makeResult(12, 12), { observability: c }), "observability");

  test("a connected full-path trace earns Strong, traced to span evidence", () => {
    const x = obs(cov());
    expect(x.rating).toBe("strong");
    expect(text(x)).toContain("connected trace");
  });

  test("bands track coverage: fragmented -> At risk, no spans -> Critical", () => {
    expect(obs(cov({ connected: false, rootSpans: 2, distinctTraces: 2 })).rating).toBe("at-risk");
    expect(
      obs(
        cov({
          totalSpans: 0,
          rootSpans: 0,
          connected: false,
          observedPhases: [],
          missingPhases: ["plan", "execute", "validate"],
          phaseCoverage: 0,
          modelCallSpans: 0,
        }),
      ).rating,
    ).toBe("critical");
  });

  test("partial phase coverage on a connected trace is Adequate, not Strong", () => {
    const x = obs(
      cov({
        observedPhases: ["plan", "execute"],
        missingPhases: ["validate"],
        phaseCoverage: 2 / 3,
      }),
    );
    expect(x.rating).toBe("adequate");
    expect(text(x)).toContain("validate");
  });
});

describe("Guardrail coverage criterion (A; scoring per ADR 0013)", () => {
  const g = (p: Partial<GuardrailCoverage>) =>
    crit(card(makeResult(12, 12), { guardrails: guard(p) }), "guardrails");

  test("bands track the weighted OWASP coverage score (when real gaps exist)", () => {
    const rating = (score: number) => g({ score, gaps: 1, gapIds: ["ASI01:2026"] }).rating;
    expect(rating(0.95)).toBe("strong");
    expect(rating(0.8)).toBe("adequate");
    expect(rating(0.5)).toBe("at-risk");
    expect(rating(0.3)).toBe("critical");
  });

  test("no-true-gaps floor: zero unaddressed applicable threats -> at least Adequate", () => {
    const x = g({
      score: 0.625,
      scoredCount: 8,
      covered: 2,
      partial: 6,
      gaps: 0,
      outOfScope: 2,
      partialIds: ["ASI01:2026"],
      outOfScopeIds: ["ASI06:2026", "ASI07:2026"],
    });
    expect(x.rating).toBe("adequate");
    expect(text(x)).toContain("Zero applicable threats are unaddressed");
  });

  test("out-of-scope threats are reported as boundaries, not gaps to close", () => {
    const x = g({
      score: 0.625,
      scoredCount: 8,
      covered: 2,
      partial: 6,
      gaps: 0,
      outOfScope: 2,
      outOfScopeIds: ["ASI06:2026", "ASI07:2026"],
    });
    expect(text(x)).toContain("Out of architectural scope");
    expect(text(x)).toContain("ASI06:2026");
    expect(text(x)).toContain("ASI07:2026");
    expect(text(x)).not.toContain("Unaddressed applicable threats to close");
  });

  test("cites the OWASP edition and names every flagged gap in the evidence", () => {
    const x = g({
      score: 0.5,
      scoredCount: 8,
      covered: 2,
      partial: 5,
      gaps: 1,
      outOfScope: 2,
      gapIds: ["ASI04:2026"],
      partialIds: ["ASI01:2026"],
      outOfScopeIds: ["ASI06:2026", "ASI07:2026"],
    });
    expect(x.rating).toBe("at-risk");
    expect(text(x)).toContain("2026");
    expect(text(x)).toContain("ASI04:2026");
  });
});

describe("Governance readiness criterion (G)", () => {
  const g = (p: Partial<GovernanceReadiness>) =>
    crit(card(makeResult(12, 12), { governance: gov(p) }), "governance");

  test("bands track the weighted EU AI Act readiness score", () => {
    expect(g({ score: 0.95 }).rating).toBe("strong");
    expect(g({ score: 0.75 }).rating).toBe("adequate");
    expect(g({ score: 0.58 }).rating).toBe("at-risk");
    expect(g({ score: 0.3 }).rating).toBe("critical");
  });

  test("cites the regulation, Omnibus status, and that readiness is not compliance", () => {
    const x = g({ deployerOwnedIds: ["Art 27"] });
    const t = text(x);
    expect(t).toContain("Regulation (EU) 2024/1689");
    expect(t).toContain("Omnibus");
    expect(t.toLowerCase()).toContain("not legal compliance");
    expect(t).toContain("Art 27");
    expect(x.state === "computed" ? x.citation.source : "").toContain(
      "governance/eu-ai-act/eu-ai-act-deployer-2026.json",
    );
  });
});

// ── D · Deployed: decision-log criteria (Phase 4B, ADR 0017) ───────────────

/** A decision-log fixture: n records, every one attributed and captured unless overridden. */
function dlog(
  n: number,
  over: (i: number) => Partial<DecisionLogEntry> = () => ({}),
  period: string | null = "13 months",
): DecisionLogEvidence {
  return {
    source: "gateway-decisions.jsonl",
    records: Array.from({ length: n }, (_, i) => ({
      requestId: `req-${i}`,
      callerId: "triage",
      callerVerified: false,
      contentCaptured: true,
      ...over(i),
    })),
    retention: { source: "docs/logging-and-retention.md", period },
  };
}

const withLog = (log: DecisionLogEvidence) => card(makeResult(12, 12), { decisionLog: log });

describe("Attributable criterion (D, 4B)", () => {
  test("without --decision-log both 4B criteria stay stubbed", () => {
    expect(crit(card(), "attributable").state).toBe("stubbed");
    expect(crit(card(), "reconstructable").state).toBe("stubbed");
  });

  test("computed from the log, citing the file, record ids, threshold and what would change it", () => {
    const x = crit(withLog(dlog(4)), "attributable");
    expect(x.state).toBe("computed");
    if (x.state !== "computed") return;
    expect(x.citation.source).toContain("gateway-decisions.jsonl");
    expect(x.citation.source).toContain("req-0");
    expect(x.citation.source).toContain("req-3");
    expect(x.citation.threshold).toContain("Strong");
    expect(x.citation.wouldChange.length).toBeGreaterThan(0);
  });

  test("every record attributed but caller ids unverified -> Adequate (4E verifies them)", () => {
    const x = crit(withLog(dlog(4)), "attributable");
    expect(x.rating).toBe("adequate");
    expect(text(x)).toContain("unverified");
  });

  test("every record attributed with verified caller ids -> Strong", () => {
    expect(crit(withLog(dlog(4, () => ({ callerVerified: true }))), "attributable").rating).toBe(
      "strong",
    );
  });

  test("bands track the share of records with a caller id; missing ids are cited", () => {
    const missing = (k: number) => dlog(10, (i) => (i < k ? { callerId: null } : {}));
    expect(crit(withLog(missing(1)), "attributable").rating).toBe("adequate"); // 90%
    expect(crit(withLog(missing(4)), "attributable").rating).toBe("at-risk"); // 60%
    expect(crit(withLog(missing(6)), "attributable").rating).toBe("critical"); // 40%
    const x = crit(withLog(missing(4)), "attributable");
    expect(x.state === "computed" ? x.citation.source : "").toContain("req-0");
  });

  test("an empty log is Critical", () => {
    expect(crit(withLog(dlog(0)), "attributable").rating).toBe("critical");
  });

  test("degraded canary: a log with missing caller ids drops D", () => {
    const healthy = dim(withLog(dlog(6, () => ({ callerVerified: true }))), "deployed");
    const degraded = dim(withLog(dlog(6, () => ({ callerId: null }))), "deployed");
    expect(healthy.rating).toBe("strong");
    expect(degraded.rating).toBe("critical");
    expect(RATING_RANK.critical).toBeLessThan(RATING_RANK.strong);
  });
});

describe("Reconstructable criterion (D, 4B)", () => {
  test("content captured on every record and a retention period stated -> Strong", () => {
    const x = crit(withLog(dlog(5)), "reconstructable");
    expect(x.rating).toBe("strong");
    expect(x.state === "computed" ? x.citation.source : "").toContain(
      "docs/logging-and-retention.md",
    );
    expect(text(x)).toContain("13 months");
  });

  test("hashes only (the default) -> Critical", () => {
    expect(
      crit(withLog(dlog(5, () => ({ contentCaptured: false }))), "reconstructable").rating,
    ).toBe("critical");
  });

  test("no retention period stated drops one band", () => {
    const x = crit(withLog(dlog(5, () => ({}), null)), "reconstructable");
    expect(x.rating).toBe("adequate");
    expect(text(x)).toContain("No retention period");
  });

  test("partial capture bands by share", () => {
    const partial = (k: number) => dlog(10, (i) => (i < k ? { contentCaptured: false } : {}));
    expect(crit(withLog(partial(2)), "reconstructable").rating).toBe("adequate"); // 80%
    expect(crit(withLog(partial(4)), "reconstructable").rating).toBe("at-risk"); // 60%
  });

  test("computed criteria count moves from stubbed to computed", () => {
    expect(withLog(dlog(3)).meta).toMatchObject({ computedCriteria: 8, stubbedCriteria: 7 });
  });
});

describe("parseRetentionPeriod", () => {
  test("reads a stated period, plain or bold", () => {
    expect(parseRetentionPeriod("- **Retention period:** 13 months\n")).toBe("13 months");
    expect(parseRetentionPeriod("Retention period: 400 days")).toBe("400 days");
  });

  test("a placeholder or a missing line is not a stated period", () => {
    expect(parseRetentionPeriod("- **Retention period:** <fill in>\n")).toBeNull();
    expect(parseRetentionPeriod("Retention period: TBD")).toBeNull();
    expect(parseRetentionPeriod("Retention period:")).toBeNull();
    expect(parseRetentionPeriod("# Logging\nnothing here")).toBeNull();
  });
});
