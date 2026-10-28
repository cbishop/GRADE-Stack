// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/scorecard
 *
 * Builds the AI Reliability Scorecard from a single eval run, graded under the
 * five GRADE letters (Governed, Reliable, Agentic, Deployed, Evaluated; ADR
 * 0016). Each letter holds named criteria. A criterion is either computed from
 * evidence, with a citation naming its source record, the threshold applied and
 * what would change the grade, or stubbed with the v3 sub-phase (4B to 4F) that
 * fills it in. There is no third state. A letter's grade is its weakest computed
 * criterion; the overall verdict is the weakest letter. Pure: no clock, no I/O.
 */

import type { TraceCoverage } from "@grade-stack/core";
import { type CaseResult, type EvalRunResult, priceFor } from "@grade-stack/evals";
import type { GovernanceReadiness } from "./eu-ai-act.ts";
import type { GuardrailCoverage } from "./owasp.ts";
import type {
  AssessedRating,
  ComputedCriterion,
  Criterion,
  Dimension,
  DimensionId,
  FillsInPhase,
  GradeLetter,
  Scorecard,
  StubbedCriterion,
} from "./types.ts";
import { RATING_LABEL, RATING_RANK } from "./types.ts";

/** Evidence inputs and display options for {@link buildScorecard}. */
export interface ScorecardOptions {
  /** Human label for the agent under test. */
  agentTask?: string;
  /**
   * Cosmetic only: surfaces a "degraded" banner. Never feeds a rating; every
   * rating must derive from evidence, so degradation has to show up in the
   * numbers, not in a flag. (It does: degraded runs fail their cases.)
   */
  degraded?: boolean;
  /**
   * Below this mean run-to-run stability, Reliability is knocked down one band:
   * a flaky pass is not a dependable pass. Default 0.9.
   */
  stabilityFloor?: number;
  /**
   * Where the eval results came from (e.g. the `--from` file path), cited by the
   * run-derived criteria. Defaults to "eval run results".
   */
  resultsSource?: string;
  /** Real trace coverage from a measured agent run (D: Observability coverage). */
  observability: TraceCoverage;
  /** Coverage of the OWASP Agentic Top 10 from the committed mapping (A: Guardrail coverage). */
  guardrails: GuardrailCoverage;
  /** EU AI Act deployer readiness from the committed module (G: Governance readiness). */
  governance: GovernanceReadiness;
}

const DEFAULT_AGENT_TASK = "Support-email triage";
const DEFAULT_STABILITY_FLOOR = 0.9;
const DEFAULT_RESULTS_SOURCE = "eval run results";

/** Committed governance records the mechanism-property criteria are computed from. */
const OWASP_SOURCE = "governance/owasp/owasp-agentic-top10-2026.json";
const EU_AI_ACT_SOURCE = "governance/eu-ai-act/eu-ai-act-deployer-2026.json";
const TRACE_PROBE_SOURCE =
  "in-memory trace probe: one reference-agent run captured by `reliability scorecard`";

/** Drop a rating by one band (Strong to Adequate to At risk to Critical), floored. */
function downgrade(rating: AssessedRating): AssessedRating {
  const order: AssessedRating[] = ["critical", "at-risk", "adequate", "strong"];
  const i = order.indexOf(rating);
  return order[Math.max(0, i - 1)] ?? rating;
}

/** The band one step better than `rating` (Strong stays Strong). */
function nextBand(rating: AssessedRating): AssessedRating {
  const order: AssessedRating[] = ["critical", "at-risk", "adequate", "strong"];
  const i = order.indexOf(rating);
  return order[Math.min(order.length - 1, i + 1)] ?? rating;
}

/** Map a pass rate in [0,1] to a reliability band. */
function reliabilityBand(passRate: number): AssessedRating {
  if (passRate >= 0.9) return "strong";
  if (passRate >= 0.75) return "adequate";
  if (passRate >= 0.5) return "at-risk";
  return "critical";
}

/**
 * The standard 0 to 1 band mapping shared by the mechanism-property criteria
 * (Guardrail coverage, Governance readiness) and Suite breadth: strong ≥0.9,
 * adequate ≥0.7, at-risk ≥0.5, else critical. Reliability and Cost use their
 * own thresholds.
 */
function standardBand(score: number): AssessedRating {
  if (score >= 0.9) return "strong";
  if (score >= 0.7) return "adequate";
  if (score >= 0.5) return "at-risk";
  return "critical";
}

/** Lower bound of each standard band, for "what would change the grade". */
const STANDARD_FLOOR: Record<AssessedRating, number> = {
  strong: 0.9,
  adequate: 0.7,
  "at-risk": 0.5,
  critical: 0,
};

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Cite the eval results file the run-derived criteria were computed from. */
function resultsCitation(result: EvalRunResult, source: string): string {
  return `${source} (${result.provider}/${result.model}, run ${result.timestamp})`;
}

/** A few failing case ids, for the evidence trail (capped so the page stays short). */
function failingIds(cases: CaseResult[], limit = 4): string[] {
  const failing = cases.filter((c) => !c.pass).map((c) => c.id);
  if (failing.length <= limit) return failing;
  return [...failing.slice(0, limit), `+${failing.length - limit} more`];
}

// ── R · Reliable ───────────────────────────────────────────────────────────

const RELIABILITY_HEADLINES: Record<AssessedRating, string> = {
  strong: "The agent handles its task dependably across the test suite.",
  adequate: "The agent usually succeeds, but a meaningful share of cases fail.",
  "at-risk": "The agent fails too often to rely on without supervision.",
  critical: "The agent fails the majority of cases and is not fit for production.",
};

const RELIABILITY_FLOOR: Record<AssessedRating, number> = {
  strong: 0.9,
  adequate: 0.75,
  "at-risk": 0.5,
  critical: 0,
};

/**
 * Reliability: does the agent do its job? Derived from the pass rate, with a
 * flakiness guard: a barely-stable pass rate is downgraded one band.
 */
function reliabilityCriterion(
  result: EvalRunResult,
  stabilityFloor: number,
  source: string,
): ComputedCriterion {
  const { summary } = result;
  let rating = reliabilityBand(summary.passRate);
  const flaky = summary.meanStability < stabilityFloor;
  if (flaky && rating !== "critical") rating = downgrade(rating);

  const evidence = [
    `${summary.passed} of ${summary.total} test cases passed (${pct(summary.passRate)}).`,
    `Run-to-run stability ${summary.meanStability.toFixed(2)} (1.00 = identical results each run)` +
      `${flaky ? "; below the dependable-result threshold, so the rating is held back one band." : "."}`,
  ];
  const failed = failingIds(result.cases);
  if (failed.length > 0) evidence.push(`Failing cases: ${failed.join(", ")}.`);

  const up = nextBand(rating);
  const wouldChange =
    rating === "strong"
      ? `Drops to Adequate below a 90% pass rate or below ${stabilityFloor.toFixed(2)} stability.`
      : `Reaching ${RATING_LABEL[up]} needs a pass rate of at least ${pct(RELIABILITY_FLOOR[up])}` +
        `${flaky ? ` and stability of at least ${stabilityFloor.toFixed(2)}` : ""}.`;

  return {
    state: "computed",
    key: "reliability",
    title: "Reliability",
    rating,
    headline: RELIABILITY_HEADLINES[rating],
    evidence,
    citation: {
      source: `${resultsCitation(result, source)}: summary.passRate, summary.meanStability`,
      threshold: `Pass rate: Strong ≥90%, Adequate ≥75%, At risk ≥50%, else Critical; held back one band below ${stabilityFloor.toFixed(2)} mean stability.`,
      wouldChange,
    },
  };
}

/** Per-case spend weight: real dollars when priced, else token volume (Ollama). */
function caseWeight(c: CaseResult, inputPerMTok: number, outputPerMTok: number): number {
  const usd =
    (c.usage.inputTokens / 1_000_000) * inputPerMTok +
    (c.usage.outputTokens / 1_000_000) * outputPerMTok;
  if (usd > 0) return usd;
  // Free provider (Ollama at $0): weight by tokens so waste is still measurable.
  return c.usage.inputTokens + c.usage.outputTokens;
}

/** Map waste fraction (spend that bought no success) to a cost band. */
function costBand(waste: number): AssessedRating {
  if (waste < 0.1) return "strong";
  if (waste < 0.25) return "adequate";
  if (waste < 0.5) return "at-risk";
  return "critical";
}

/** Upper bound (exclusive) on wasted spend for each cost band. */
const COST_CEILING: Record<AssessedRating, number> = {
  strong: 0.1,
  adequate: 0.25,
  "at-risk": 0.5,
  critical: 1,
};

const COST_HEADLINES: Record<AssessedRating, string> = {
  strong: "Almost every dollar spent produces a usable result.",
  adequate: "Most spend is productive, but failures add a real tax to each success.",
  "at-risk": "A large share of spend produces nothing usable.",
  critical: "Spend is mostly wasted; there is little or no successful output to pay for.",
};

/**
 * Cost discipline: how much money buys a *successful* outcome. Graded under R
 * (ADR 0016) because the router and the cost cap are reliability-per-dollar
 * controls. The rating is the **waste fraction**: the share of total spend that
 * produced no passing result, computed from real per-case usage.
 */
function costCriterion(result: EvalRunResult, source: string): ComputedCriterion {
  const { summary } = result;
  const { cost } = summary;
  const { price } = priceFor(result.provider, result.model);

  const totalWeight = result.cases.reduce(
    (s, c) => s + caseWeight(c, price.inputPerMTok, price.outputPerMTok),
    0,
  );
  const wastedWeight = result.cases
    .filter((c) => !c.pass)
    .reduce((s, c) => s + caseWeight(c, price.inputPerMTok, price.outputPerMTok), 0);
  const waste = totalWeight === 0 ? 1 : wastedWeight / totalWeight;

  // Nothing passed: cost-per-success is undefined; that is the worst case.
  const rating: AssessedRating = summary.passed === 0 ? "critical" : costBand(waste);

  const free = cost.basis === "free";
  const perSuccess =
    cost.usdPerSuccess === null
      ? "undefined (no case passed)"
      : free
        ? `${Math.round(cost.tokensPerSuccess ?? 0)} tokens ($0 list cost)`
        : `$${cost.usdPerSuccess.toFixed(5)} (${Math.round(cost.tokensPerSuccess ?? 0)} tokens)`;

  const basisLabel =
    cost.basis === "free"
      ? "no per-token cost (self-hosted)"
      : cost.basis === "amortized"
        ? "amortized self-host rate"
        : "list price";

  const evidence = [
    `Cost per successful outcome: ${perSuccess}.`,
    free
      ? `Total run cost $0 on ${result.provider}/${result.model}: ${basisLabel}; the spend signal here is token volume.`
      : `Total run cost $${cost.totalUsd.toFixed(5)} on ${result.provider}/${result.model}: ${basisLabel}.`,
    `${pct(waste)} of spend produced no passing result.`,
  ];

  const up = nextBand(rating);
  const wouldChange =
    rating === "strong"
      ? "Drops to Adequate once 10% or more of spend buys no passing result."
      : summary.passed === 0
        ? "Any passing case defines a cost per success; the band then follows the share of wasted spend."
        : `Reaching ${RATING_LABEL[up]} needs wasted spend under ${pct(COST_CEILING[up])}.`;

  return {
    state: "computed",
    key: "cost-discipline",
    title: "Cost discipline",
    rating,
    headline: COST_HEADLINES[rating],
    evidence,
    citation: {
      source: `${resultsCitation(result, source)}: per-case usage priced by @grade-stack/evals priceFor`,
      threshold:
        "Wasted spend: Strong <10%, Adequate <25%, At risk <50%, else Critical; Critical when no case passes.",
      wouldChange,
    },
  };
}

// ── D · Deployed ───────────────────────────────────────────────────────────

const OBSERVABILITY_HEADLINES: Record<AssessedRating, string> = {
  strong: "Every step the agent takes is captured as one connected, inspectable trace.",
  adequate: "Most of the agent's path is traced, but some steps are not yet visible.",
  "at-risk": "Traces exist but do not connect into one picture of a run, so debugging is hard.",
  critical: "The agent emits no traces; its behavior cannot be observed after the fact.",
};

/**
 * Observability coverage: can a team *see* what the agent did? Computed from
 * real trace coverage: a connected plan, model, validation trace with every
 * phase captured is strong; a fragmented or partial trace is not. Tool-call
 * spans are emitted when MCP grounding runs, so they are not required of this
 * core-path probe and never penalize the rating.
 */
function observabilityCriterion(coverage: TraceCoverage): ComputedCriterion {
  let rating: AssessedRating;
  if (coverage.totalSpans === 0) {
    rating = "critical";
  } else if (!coverage.connected) {
    rating = "at-risk";
  } else if (coverage.phaseCoverage >= 1 && coverage.modelCallSpans >= 1) {
    rating = "strong";
  } else if (coverage.phaseCoverage >= 2 / 3) {
    rating = "adequate";
  } else {
    rating = "at-risk";
  }

  const phases = coverage.observedPhases.length > 0 ? coverage.observedPhases.join(" → ") : "none";
  const evidence = [
    coverage.connected
      ? `A full run produces one connected trace: ${coverage.totalSpans} spans, single root, single trace id.`
      : `Trace is not connected: ${coverage.rootSpans} root span(s) across ${coverage.distinctTraces} trace(s); steps do not link into one run.`,
    `Agent phases captured as spans: ${phases} (${coverage.observedPhases.length}/3).`,
    `Model calls traced with GenAI semantic conventions: ${coverage.modelCallSpans}.`,
  ];
  if (coverage.missingPhases.length > 0) {
    evidence.push(`Phases not traced: ${coverage.missingPhases.join(", ")}.`);
  }

  return {
    state: "computed",
    key: "observability",
    title: "Observability coverage",
    rating,
    headline: OBSERVABILITY_HEADLINES[rating],
    evidence,
    citation: {
      source: TRACE_PROBE_SOURCE,
      threshold:
        "Strong: one connected trace, 3/3 phases, at least one model-call span; Adequate: connected with at least 2/3 phases; At risk: fragmented; Critical: no spans.",
      wouldChange:
        rating === "strong"
          ? "Drops if the trace fragments or a phase stops being captured."
          : "Reaching Strong needs one connected trace with all three phases and a traced model call.",
    },
  };
}

// ── A · Agentic ────────────────────────────────────────────────────────────

const GUARDRAIL_HEADLINES: Record<AssessedRating, string> = {
  strong:
    "The stack addresses nearly every applicable OWASP agentic threat with a named mechanism.",
  adequate:
    "Every applicable OWASP agentic threat has a mechanism, though several are only partly covered.",
  "at-risk":
    "Real guardrails exist, but coverage of the applicable OWASP agentic threats is incomplete; known gaps remain.",
  critical: "Most applicable OWASP agentic threats have no mechanism in this stack.",
};

/**
 * Guardrail coverage: how much of the OWASP Agentic Top 10 the stack's
 * mechanisms address (scoring per ADR 0013), computed over the **applicable**
 * threats: covered counts full, partial half, gaps nothing. Out-of-scope threats
 * are reported as boundaries and never drag the denominator. A "no true gaps"
 * floor keeps the rating at least Adequate when every applicable threat has a
 * mechanism.
 */
function guardrailsCriterion(coverage: GuardrailCoverage): ComputedCriterion {
  let rating = standardBand(coverage.score);
  // "No true gaps" floor (ADR 0013): shallow coverage is not a hole.
  const noTrueGaps = coverage.scoredCount > 0 && coverage.gaps === 0;
  if (noTrueGaps && RATING_RANK[rating] < RATING_RANK.adequate) {
    rating = "adequate";
  }

  const evidence = [
    `Mapped against the ${coverage.taxonomy} (${coverage.version}, published ${coverage.publishedAt}).`,
    `${coverage.scoredCount} of ${coverage.total} threats apply to this architecture; of those, ` +
      `${coverage.covered} fully covered, ${coverage.partial} partial, ${coverage.gaps} unaddressed ` +
      `(weighted coverage ${pct(coverage.score)}).`,
  ];
  if (coverage.gapIds.length > 0) {
    evidence.push(
      `Unaddressed applicable threats to close before deployment: ${coverage.gapIds.join(", ")}.`,
    );
  } else if (coverage.scoredCount > 0) {
    evidence.push(
      "Zero applicable threats are unaddressed: every applicable threat has a named mechanism.",
    );
  }
  if (coverage.partialIds.length > 0) {
    evidence.push(
      `Partially covered (named residual gap each): ${coverage.partialIds.join(", ")}.`,
    );
  }
  if (coverage.outOfScopeIds.length > 0) {
    evidence.push(
      `Out of architectural scope, not deficiencies: ${coverage.outOfScopeIds.join(", ")}. ` +
        "These target capabilities a single-agent, stateless stack does not include; they become " +
        "relevant only if a deployment adds them (e.g. persistent memory/RAG, multi-agent messaging).",
    );
  }

  const up = nextBand(rating);
  const wouldChange =
    rating === "strong"
      ? "Drops below 90% weighted coverage, e.g. if a covered threat loses its mechanism."
      : `Reaching ${RATING_LABEL[up]} needs weighted coverage of at least ${pct(STANDARD_FLOOR[up])}; ` +
        `each partial threat moved to covered adds ${pct(0.5 / Math.max(1, coverage.scoredCount))}.`;

  return {
    state: "computed",
    key: "guardrails",
    title: "Guardrail coverage",
    rating,
    headline: GUARDRAIL_HEADLINES[rating],
    evidence,
    citation: {
      source: `${OWASP_SOURCE} (${coverage.taxonomy} ${coverage.version})`,
      threshold:
        "Weighted coverage of applicable threats (covered 1, partial 0.5, gap 0): Strong ≥90%, Adequate ≥70%, At risk ≥50%, else Critical; floored at Adequate when no applicable threat is unaddressed (ADR 0013).",
      wouldChange,
    },
  };
}

// ── G · Governed ───────────────────────────────────────────────────────────

const GOVERNANCE_HEADLINES: Record<AssessedRating, string> = {
  strong:
    "The stack readies a deployer for nearly every supportable EU AI Act obligation; compliance itself stays the deployer's.",
  adequate:
    "The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's.",
  "at-risk":
    "The stack covers some EU AI Act readiness, but much remains the deployer's process or legal work.",
  critical: "The stack provides little EU AI Act readiness on its own.",
};

/**
 * Governance readiness: how ready the stack makes a deployer for the EU AI Act,
 * computed from the committed `governance/eu-ai-act` module's weighted readiness
 * over stack-supportable deployer obligations. This rates *readiness*, never
 * legal compliance, which is always the deployer's.
 */
function governanceCriterion(readiness: GovernanceReadiness): ComputedCriterion {
  const rating = standardBand(readiness.score);

  const evidence = [
    `Mapped against the ${readiness.framework} (${readiness.regulation}), re-verified ${readiness.retrievedAt}.`,
    `Readiness ${pct(readiness.score)} over ${readiness.scoredCount} stack-supportable deployer obligations ` +
      `(${readiness.supported} supported, ${readiness.partial} partial, ${readiness.deployerOwned} deployer-owned).`,
    `In force now / from 2026-08-02: ${readiness.inForceNowIds.join(", ")}.`,
    `Digital Omnibus: ${readiness.omnibusStage}`,
  ];
  if (readiness.deployerOwnedIds.length > 0) {
    evidence.push(
      `Legal duties that remain the deployer's (no software satisfies them): ${readiness.deployerOwnedIds.join(", ")}.`,
    );
  }
  evidence.push("Governance readiness is not legal compliance; compliance is the deployer's.");

  const up = nextBand(rating);
  const wouldChange =
    rating === "strong"
      ? "Drops below 90% if an obligation is downgraded from supported."
      : `Reaching ${RATING_LABEL[up]} needs readiness of at least ${pct(STANDARD_FLOOR[up])}; ` +
        `each obligation moved from partial to supported by a shipped mechanism adds ${pct(0.5 / Math.max(1, readiness.scoredCount))}.`;

  return {
    state: "computed",
    key: "governance",
    title: "Governance readiness",
    rating,
    headline: GOVERNANCE_HEADLINES[rating],
    evidence,
    citation: {
      source: `${EU_AI_ACT_SOURCE} (${readiness.regulation}, re-verified ${readiness.retrievedAt})`,
      threshold:
        "Weighted readiness over scored obligations (supported 1, partial 0.5, deployer-owned 0): Strong ≥90%, Adequate ≥70%, At risk ≥50%, else Critical.",
      wouldChange,
    },
  };
}

// ── E · Evaluated ──────────────────────────────────────────────────────────

/** Minimum suite size for the breadth check. */
const MIN_SUITE_CASES = 10;
/** A case that probes refusal or out-of-distribution behavior, by id or description. */
const REFUSAL_OR_OOD = /refus|(^|[-_\s])ood([-_\s]|$)|out-of-distribution|off-topic/i;
/** An LLM-as-judge metric in any case's trace. */
const JUDGE_METRIC = /judge/i;

const BREADTH_HEADLINES: Record<AssessedRating, string> = {
  strong:
    "The suite has the basic breadth a pass rate needs: enough cases, a refusal or off-topic probe, and a judge metric.",
  adequate: "The suite covers most of the basic breadth a pass rate needs, with one gap.",
  "at-risk": "The suite is missing one of the three things that give its pass rate meaning.",
  critical: "The suite is too narrow for its pass rate to mean much.",
};

/**
 * Suite breadth: is the eval suite itself broad enough that its pass rate means
 * something? Computed from the results file with three checks: at least 10
 * cases, a refusal or out-of-distribution case, and an LLM-judge metric. The
 * share of checks met is banded with the standard bands, so missing any one
 * check is At risk. Trust in the judge and the real-model cadence are 4F's.
 */
function suiteBreadthCriterion(result: EvalRunResult, source: string): ComputedCriterion {
  const caseCount = result.cases.length;
  const probe = result.cases.find(
    (c) => REFUSAL_OR_OOD.test(c.id) || REFUSAL_OR_OOD.test(c.description),
  );
  const judgeMetric = result.cases
    .flatMap((c) => c.trace.flatMap((s) => s.checks.map((k) => k.metric)))
    .find((m) => JUDGE_METRIC.test(m));

  const checks = [
    { ok: caseCount >= MIN_SUITE_CASES, missing: `at least ${MIN_SUITE_CASES} cases` },
    { ok: probe !== undefined, missing: "a refusal or out-of-distribution case" },
    { ok: judgeMetric !== undefined, missing: "an LLM-judge metric" },
  ];
  const met = checks.filter((c) => c.ok).length;
  const rating = standardBand(met / checks.length);
  const missing = checks.filter((c) => !c.ok).map((c) => c.missing);

  const evidence = [
    `${caseCount} cases in the suite (${caseCount >= MIN_SUITE_CASES ? "meets" : "below"} the ${MIN_SUITE_CASES}-case minimum).`,
    probe
      ? `Refusal or out-of-distribution probe present: ${probe.id}.`
      : "No refusal or out-of-distribution case found by id or description.",
    judgeMetric
      ? `LLM-judge metric present: ${judgeMetric}.`
      : "No LLM-judge metric found in any case's checks.",
  ];
  if (missing.length > 0) evidence.push(`Missing: ${missing.join("; ")}.`);

  return {
    state: "computed",
    key: "suite-breadth",
    title: "Suite breadth",
    rating,
    headline: BREADTH_HEADLINES[rating],
    evidence,
    citation: {
      source: `${resultsCitation(result, source)}: cases[].id, cases[].trace[].checks[].metric`,
      threshold:
        "Three checks (10 or more cases; a refusal or out-of-distribution case; an LLM-judge metric), share met on the standard bands: all three Strong, two At risk, one or none Critical.",
      wouldChange:
        rating === "strong"
          ? "Drops if the suite falls below 10 cases or loses its refusal/OOD case or judge metric."
          : `Reaching Strong needs ${missing.join("; ")}.`,
    },
  };
}

// ── Stubs and rollups ──────────────────────────────────────────────────────

/** A criterion with no evidence yet, naming the v3 sub-phase that fills it in. */
function stub(
  key: string,
  title: string,
  fillsIn: FillsInPhase,
  computedFrom: string,
): StubbedCriterion {
  return { state: "stubbed", key, title, rating: "not-assessed", fillsIn, computedFrom };
}

/** Static description of one GRADE letter. */
interface LetterSpec {
  id: DimensionId;
  letter: GradeLetter;
  title: string;
  question: string;
}

const LETTERS: Record<DimensionId, LetterSpec> = {
  governed: {
    id: "governed",
    letter: "G",
    title: "Governed",
    question:
      "Can you show who owns the agent, what it is allowed to do, and how those limits are enforced?",
  },
  reliable: {
    id: "reliable",
    letter: "R",
    title: "Reliable",
    question: "Does the agent behave consistently, at a cost that buys results?",
  },
  agentic: {
    id: "agentic",
    letter: "A",
    title: "Agentic",
    question:
      "Does the agent have exactly the autonomy and tool access its job needs, and no more?",
  },
  deployed: {
    id: "deployed",
    letter: "D",
    title: "Deployed",
    question: "Can a team run it, see what it did, and undo a bad release?",
  },
  evaluated: {
    id: "evaluated",
    letter: "E",
    title: "Evaluated",
    question: "Is quality measured before and after every change, by a suite you can trust?",
  },
};

/**
 * Assemble one letter. Its grade is the weakest computed criterion (ADR 0016);
 * stubs are listed but never move the grade. With no computed criterion the
 * letter is `not-assessed`.
 */
function dimension(id: DimensionId, criteria: Criterion[]): Dimension {
  const spec = LETTERS[id];
  const computed = criteria.filter((c): c is ComputedCriterion => c.state === "computed");
  const nextPhase = criteria.find((c): c is StubbedCriterion => c.state === "stubbed")?.fillsIn;
  if (computed.length === 0) {
    return {
      ...spec,
      rating: "not-assessed",
      headline: `Not yet assessed; fills in Phase ${nextPhase ?? "4B"}.`,
      criteria,
      assessed: false,
    };
  }
  const weakest = computed.reduce((acc, c) =>
    RATING_RANK[c.rating] < RATING_RANK[acc.rating] ? c : acc,
  );
  return {
    ...spec,
    rating: weakest.rating,
    headline: weakest.headline,
    criteria,
    assessed: true,
  };
}

/** Roll the graded letters up into a single overall verdict (worst letter wins). */
function overallVerdict(dimensions: Dimension[], stubbed: number): Scorecard["overall"] {
  const assessed = dimensions.filter(
    (d): d is Dimension & { rating: AssessedRating } => d.assessed,
  );
  if (assessed.length === 0) {
    return {
      rating: "not-assessed",
      headline: "No GRADE letter can be graded from evidence yet.",
    };
  }
  const worst = assessed.reduce((acc, d) =>
    RATING_RANK[d.rating] < RATING_RANK[acc.rating] ? d : acc,
  );
  // Name the letter that set the verdict, so a reader knows where to look.
  const driver = `Weakest dimension: ${worst.letter} · ${worst.title} (${RATING_LABEL[worst.rating]}).`;
  const pending =
    stubbed > 0
      ? ` ${stubbed} criteria are not yet assessed; each names the sub-phase that fills it in.`
      : "";
  const verdict =
    worst.rating === "strong"
      ? "On the evidence available today, the agent looks production-ready."
      : worst.rating === "adequate"
        ? `Workable, but with gaps a team should close before relying on it unsupervised. ${driver}`
        : worst.rating === "at-risk"
          ? `Not ready for unsupervised production use; the weakest dimension needs work. ${driver}`
          : `Not production-ready; a core dimension is failing. ${driver}`;
  return { rating: worst.rating, headline: `${verdict}${pending}` };
}

/**
 * Build a one-page AI Reliability Scorecard from a single eval run plus the
 * measured trace coverage and the committed governance mappings. Pure: no
 * clock, no I/O; the timestamp is carried from the eval result so the same
 * inputs always yield the same scorecard.
 */
export function buildScorecard(result: EvalRunResult, opts: ScorecardOptions): Scorecard {
  const stabilityFloor = opts.stabilityFloor ?? DEFAULT_STABILITY_FLOOR;
  const source = opts.resultsSource ?? DEFAULT_RESULTS_SOURCE;

  const dimensions: Dimension[] = [
    dimension("governed", [
      governanceCriterion(opts.governance),
      stub(
        "human-oversight",
        "Human oversight record",
        "4D",
        "the review queue: low-confidence output held for a named approver, with approver and time recorded",
      ),
      stub(
        "boundary-register",
        "Boundary register",
        "4E",
        "the per-agent manifests and boundary register (autonomy level, allowed tools and models, turn and token limits)",
      ),
    ]),
    dimension("reliable", [
      reliabilityCriterion(result, stabilityFloor, source),
      costCriterion(result, source),
    ]),
    dimension("agentic", [
      guardrailsCriterion(opts.guardrails),
      stub(
        "autonomy-scope",
        "Declared vs observed autonomy and tool scope",
        "4E",
        "per-agent manifests enforced at the gateway and MCP server, compared with the calls the decision log observed",
      ),
    ]),
    dimension("deployed", [
      observabilityCriterion(opts.observability),
      stub(
        "attributable",
        "Attributable and reconstructable",
        "4B",
        "the gateway decision log: request id, caller id, policy fired, and input and output hashes per request",
      ),
      stub(
        "rollback",
        "Rollback verified",
        "4C",
        "a dated kill-switch drill record and the release manifest that names the last good version",
      ),
    ]),
    dimension("evaluated", [
      suiteBreadthCriterion(result, source),
      stub(
        "real-model-freshness",
        "Last real-model run freshness",
        "4F",
        "the nightly real-model eval job record (date, model, pass rate)",
      ),
      stub(
        "judge-calibration",
        "Judge calibration",
        "4F",
        "judge-vs-human agreement on hand-labeled cases from `reliability eval calibrate`",
      ),
      stub(
        "post-deployment-rescore",
        "Post-deployment re-score",
        "4F",
        "captured production traces re-scored by `reliability eval run --from-traces`",
      ),
    ]),
  ];

  const all = dimensions.flatMap((d) => d.criteria);
  const stubbedCriteria = all.filter((c) => c.state === "stubbed").length;

  return {
    generatedAt: result.timestamp,
    agentTask: opts.agentTask ?? DEFAULT_AGENT_TASK,
    provider: result.provider,
    model: result.model,
    degraded: opts.degraded ?? false,
    overall: overallVerdict(dimensions, stubbedCriteria),
    dimensions,
    meta: {
      assessedCount: dimensions.filter((d) => d.assessed).length,
      totalDimensions: dimensions.length,
      computedCriteria: all.length - stubbedCriteria,
      stubbedCriteria,
    },
  };
}
