// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/scorecard
 *
 * Builds the AI Reliability Scorecard from a single eval run — mapping eval
 * evidence to executive dimensions (Reliability and Cost discipline computed in
 * Phase 1C; Observability from real trace coverage in Phase 2D when measured;
 * Guardrail coverage from the OWASP Agentic Top 10 mapping in Phase 3A when
 * supplied; Governance readiness from the EU AI Act deployer module in Phase 3C
 * when supplied — all five dimensions now computable). Pure: no clock, no I/O.
 */

import type { TraceCoverage } from "@grade-stack/core";
import { type CaseResult, type EvalRunResult, priceFor } from "@grade-stack/evals";
import type { GovernanceReadiness } from "./eu-ai-act.ts";
import type { GuardrailCoverage } from "./owasp.ts";
import type { Dimension, Rating, Scorecard } from "./types.ts";
import { RATING_LABEL, RATING_RANK } from "./types.ts";

/** Options for {@link buildScorecard}. */
export interface ScorecardOptions {
  /** Human label for the agent under test. */
  agentTask?: string;
  /**
   * Cosmetic only — surfaces a "degraded" banner. Never feeds a rating: every
   * rating must derive from eval evidence, so degradation has to show up in the
   * numbers, not in a flag. (It does: degraded runs fail their cases.)
   */
  degraded?: boolean;
  /**
   * Below this mean run-to-run stability, Reliability is knocked down one band —
   * a flaky pass is not a dependable pass. Default 0.9 (the 1A flakiness signal).
   */
  stabilityFloor?: number;
  /**
   * Real trace coverage from a measured agent run (Phase 2D). When provided, the
   * Observability dimension is computed from it; when omitted it stays honestly
   * stubbed. The CLI measures this with a hermetic in-memory trace probe.
   */
  observability?: TraceCoverage;
  /**
   * Guardrail coverage against the OWASP Agentic Top 10 (Phase 3A). When
   * provided, the Guardrail-coverage dimension is computed from it; when omitted
   * it stays honestly stubbed. The CLI derives this from the committed
   * `governance/owasp` mapping. Unlike Reliability/Cost/Observability it is a
   * property of the *stack's mechanisms*, not of the run — so it is independent
   * of degraded mode.
   */
  guardrails?: GuardrailCoverage;
  /**
   * Governance readiness from the EU AI Act deployer module (Phase 3C — the last
   * dimension). When provided, the Governance-readiness dimension is computed from
   * it; when omitted it stays honestly stubbed. Like guardrails, it is a property
   * of the *stack's mechanisms* (how ready the stack makes a deployer), not of the
   * run — so it is independent of degraded mode. It rates readiness, NOT legal
   * compliance, which remains the deployer's.
   */
  governance?: GovernanceReadiness;
}

const DEFAULT_AGENT_TASK = "Support-email triage";
const DEFAULT_STABILITY_FLOOR = 0.9;

/** Drop a rating by one band (Strong→Adequate→At risk→Critical), floored. */
function downgrade(rating: Exclude<Rating, "not-assessed">): Exclude<Rating, "not-assessed"> {
  const order: Exclude<Rating, "not-assessed">[] = ["critical", "at-risk", "adequate", "strong"];
  const i = order.indexOf(rating);
  return order[Math.max(0, i - 1)] ?? rating;
}

/** Map a pass rate in [0,1] to a reliability band. */
function reliabilityBand(passRate: number): Exclude<Rating, "not-assessed"> {
  if (passRate >= 0.9) return "strong";
  if (passRate >= 0.75) return "adequate";
  if (passRate >= 0.5) return "at-risk";
  return "critical";
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** A few failing case ids, for the evidence trail (capped so the page stays short). */
function failingIds(cases: CaseResult[], limit = 4): string[] {
  const failing = cases.filter((c) => !c.pass).map((c) => c.id);
  if (failing.length <= limit) return failing;
  return [...failing.slice(0, limit), `+${failing.length - limit} more`];
}

const RELIABILITY_HEADLINES: Record<Exclude<Rating, "not-assessed">, string> = {
  strong: "The agent handles its task dependably across the test suite.",
  adequate: "The agent usually succeeds, but a meaningful share of cases fail.",
  "at-risk": "The agent fails too often to rely on without supervision.",
  critical: "The agent fails the majority of cases — not fit for production.",
};

/**
 * Reliability — does the agent do its job? Derived from the pass rate, with a
 * flakiness guard: a barely-stable pass rate is downgraded one band.
 */
function reliabilityDimension(result: EvalRunResult, stabilityFloor: number): Dimension {
  const { summary } = result;
  let rating = reliabilityBand(summary.passRate);
  const flaky = summary.meanStability < stabilityFloor;
  if (flaky && rating !== "critical") rating = downgrade(rating);

  const headline = RELIABILITY_HEADLINES[rating];

  const evidence = [
    `${summary.passed} of ${summary.total} test cases passed (${pct(summary.passRate)}).`,
    `Run-to-run stability ${summary.meanStability.toFixed(2)} (1.00 = identical results each run)` +
      `${flaky ? " — below the dependable-result threshold, so the rating is held back one band." : "."}`,
  ];
  const failed = failingIds(result.cases);
  if (failed.length > 0) {
    evidence.push(`Failing cases: ${failed.join(", ")}.`);
  }

  return { key: "reliability", title: "Reliability", rating, headline, evidence, assessed: true };
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
function costBand(waste: number): Exclude<Rating, "not-assessed"> {
  if (waste < 0.1) return "strong";
  if (waste < 0.25) return "adequate";
  if (waste < 0.5) return "at-risk";
  return "critical";
}

const COST_HEADLINES: Record<Exclude<Rating, "not-assessed">, string> = {
  strong: "Almost every dollar spent produces a usable result.",
  adequate: "Most spend is productive, but failures add a real tax to each success.",
  "at-risk": "A large share of spend produces nothing usable.",
  critical: "Spend is mostly wasted — there is little or no successful output to pay for.",
};

/**
 * Cost discipline — how much money buys a *successful* outcome. The board-legible
 * angle from Phase 1B: every failed run is spend with nothing to show for it.
 * Rating is the **waste fraction** — the share of total spend that produced no
 * passing result — computed from real per-case usage, not just the pass rate.
 */
function costDimension(result: EvalRunResult): Dimension {
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

  // Nothing passed → cost-per-success is undefined; that is the worst case.
  const rating: Exclude<Rating, "not-assessed"> =
    summary.passed === 0 ? "critical" : costBand(waste);

  const free = cost.basis === "free";
  const perSuccess =
    cost.usdPerSuccess === null
      ? "undefined (no case passed)"
      : free
        ? `${Math.round(cost.tokensPerSuccess ?? 0)} tokens ($0 list cost)`
        : `$${cost.usdPerSuccess.toFixed(5)} (${Math.round(cost.tokensPerSuccess ?? 0)} tokens)`;

  const headline = COST_HEADLINES[rating];

  const basisLabel =
    cost.basis === "free"
      ? "no per-token cost (self-hosted)"
      : cost.basis === "amortized"
        ? "amortized self-host rate"
        : "list price";

  const evidence = [
    `Cost per successful outcome: ${perSuccess}.`,
    free
      ? `Total run cost $0 on ${result.provider}/${result.model} — ${basisLabel}; the spend signal here is token volume.`
      : `Total run cost $${cost.totalUsd.toFixed(5)} on ${result.provider}/${result.model} — ${basisLabel}.`,
    `${pct(waste)} of spend produced no passing result.`,
  ];

  return {
    key: "cost-discipline",
    title: "Cost discipline",
    rating,
    headline,
    evidence,
    assessed: true,
  };
}

const OBSERVABILITY_HEADLINES: Record<Exclude<Rating, "not-assessed">, string> = {
  strong: "Every step the agent takes is captured as one connected, inspectable trace.",
  adequate: "Most of the agent's path is traced, but some steps aren't yet visible.",
  "at-risk": "Traces exist but don't connect into one picture of a run — hard to debug.",
  critical: "The agent emits no traces — its behavior can't be observed after the fact.",
};

/**
 * Observability coverage — can a team *see* what the agent did? Computed from
 * real trace coverage (Phase 2D): a connected plan → model → validation trace
 * with every phase captured is strong; a fragmented or partial trace is not.
 * Tool-call spans are emitted when MCP grounding runs, so they are not required
 * of this core-path probe and never penalize the rating.
 */
function observabilityDimension(coverage: TraceCoverage): Dimension {
  let rating: Exclude<Rating, "not-assessed">;
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

  const headline = OBSERVABILITY_HEADLINES[rating];

  const phases = coverage.observedPhases.length > 0 ? coverage.observedPhases.join(" → ") : "none";
  const evidence = [
    coverage.connected
      ? `A full run produces one connected trace: ${coverage.totalSpans} spans, single root, single trace id.`
      : `Trace is not connected: ${coverage.rootSpans} root span(s) across ${coverage.distinctTraces} trace(s) — steps don't link into one run.`,
    `Agent phases captured as spans: ${phases} (${coverage.observedPhases.length}/3).`,
    `Model calls traced with GenAI semantic conventions: ${coverage.modelCallSpans}.`,
  ];
  if (coverage.missingPhases.length > 0) {
    evidence.push(`Phases not traced: ${coverage.missingPhases.join(", ")}.`);
  }

  return {
    key: "observability",
    title: "Observability coverage",
    rating,
    headline,
    evidence,
    assessed: true,
  };
}

/**
 * The standard 0–1 → band mapping shared by the mechanism-property dimensions
 * (Guardrail coverage and Governance readiness): strong ≥0.9, adequate ≥0.7,
 * at-risk ≥0.5, else critical. Reliability and Cost use their own thresholds.
 */
function standardBand(score: number): Exclude<Rating, "not-assessed"> {
  if (score >= 0.9) return "strong";
  if (score >= 0.7) return "adequate";
  if (score >= 0.5) return "at-risk";
  return "critical";
}

const GUARDRAIL_HEADLINES: Record<Exclude<Rating, "not-assessed">, string> = {
  strong:
    "The stack addresses nearly every applicable OWASP agentic threat with a named mechanism.",
  adequate:
    "Every applicable OWASP agentic threat has a mechanism, though several are only partly covered.",
  "at-risk":
    "Real guardrails exist, but coverage of the applicable OWASP agentic threats is incomplete — known gaps remain.",
  critical: "Most applicable OWASP agentic threats have no mechanism in this stack.",
};

/**
 * Guardrail coverage — how much of the OWASP Agentic Top 10 the stack's
 * mechanisms actually address (Phase 3A; scoring revised per ADR 0013). Computed
 * from the committed `governance/owasp` mapping over the **applicable** threats:
 * covered counts full, partial half, gaps nothing. Threats out of architectural
 * scope (no such capability in a single-agent, stateless stack) are reported as
 * boundaries, never as gaps to close, and never drag the denominator. A "no true
 * gaps" floor keeps the rating at least Adequate when every applicable threat has
 * a mechanism — shallow coverage is not a hole. Every gap, partial, and out-of-
 * scope id is named so the rating is never a black box, and the OWASP edition is
 * cited so the score is anchored to a known taxonomy.
 */
function guardrailsDimension(coverage: GuardrailCoverage): Dimension {
  let rating = standardBand(coverage.score);
  // "No true gaps" floor (ADR 0013): if every applicable threat has at least a
  // named mechanism (zero unaddressed gaps), the stack cannot be worse than
  // Adequate on guardrails. Partial (shallow) coverage is not the same as a hole.
  const noTrueGaps = coverage.scoredCount > 0 && coverage.gaps === 0;
  if (noTrueGaps && RATING_RANK[rating] < RATING_RANK.adequate) {
    rating = "adequate";
  }

  const headline = GUARDRAIL_HEADLINES[rating];

  const evidence = [
    `Mapped against the ${coverage.taxonomy} (${coverage.version}, published ${coverage.publishedAt}).`,
    `${coverage.scoredCount} of ${coverage.total} threats apply to this architecture; of those, ` +
      `${coverage.covered} fully covered, ${coverage.partial} partial, ${coverage.gaps} unaddressed ` +
      `(weighted coverage ${pct(coverage.score)}; bands: strong ≥90%, adequate ≥70%, at-risk ≥50%).`,
  ];
  if (coverage.gapIds.length > 0) {
    evidence.push(
      `Unaddressed applicable threats to close before deployment: ${coverage.gapIds.join(", ")}.`,
    );
  } else if (coverage.scoredCount > 0) {
    evidence.push(
      "Zero applicable threats are unaddressed — every applicable threat has a named mechanism.",
    );
  }
  if (coverage.partialIds.length > 0) {
    evidence.push(
      `Partially covered (named residual gap each): ${coverage.partialIds.join(", ")}.`,
    );
  }
  if (coverage.outOfScopeIds.length > 0) {
    evidence.push(
      `Out of architectural scope — not deficiencies: ${coverage.outOfScopeIds.join(", ")}. ` +
        "These target capabilities a single-agent, stateless stack does not include; they become " +
        "relevant only if a deployment adds them (e.g. persistent memory/RAG, multi-agent messaging).",
    );
  }

  return {
    key: "guardrails",
    title: "Guardrail coverage",
    rating,
    headline,
    evidence,
    assessed: true,
  };
}

const GOVERNANCE_HEADLINES: Record<Exclude<Rating, "not-assessed">, string> = {
  strong:
    "The stack readies a deployer for nearly every supportable EU AI Act obligation — compliance itself stays the deployer's.",
  adequate:
    "The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's.",
  "at-risk":
    "The stack covers some EU AI Act readiness, but much remains the deployer's program work.",
  critical: "The stack provides little EU AI Act readiness on its own.",
};

/**
 * Governance readiness — how ready the stack makes a deployer for the EU AI Act
 * (Phase 3C, the last dimension). Computed from the committed `governance/eu-ai-act`
 * module: the weighted readiness over stack-supportable deployer obligations sets
 * the band. The evidence cites the regulation + re-verification date, the Digital
 * Omnibus's legal status, and names the legal duties that remain the deployer's.
 * This rates *readiness*, never legal compliance — which is always the deployer's.
 */
function governanceDimension(readiness: GovernanceReadiness): Dimension {
  const rating = standardBand(readiness.score);

  const headline = GOVERNANCE_HEADLINES[rating];

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
  evidence.push("Governance readiness is not legal compliance — compliance is the deployer's.");

  return {
    key: "governance",
    title: "Governance readiness",
    rating,
    headline,
    evidence,
    assessed: true,
  };
}

/** A not-yet-assessed dimension, honest about which phase computes it. */
function stubDimension(
  key: string,
  title: string,
  plannedPhase: string,
  computedFrom: string,
): Dimension {
  return {
    key,
    title,
    rating: "not-assessed",
    headline: `Not yet assessed — this dimension is computed in ${plannedPhase}.`,
    evidence: [
      `Will be computed from ${computedFrom} (${plannedPhase}). No score is asserted until then.`,
    ],
    assessed: false,
    plannedPhase,
  };
}

/** Roll the assessed dimensions up into a single overall verdict (worst band wins). */
function overallVerdict(dimensions: Dimension[]): Scorecard["overall"] {
  const assessed = dimensions.filter(
    (d): d is Dimension & { rating: Exclude<Rating, "not-assessed"> } => d.assessed,
  );
  if (assessed.length === 0) {
    return {
      rating: "not-assessed",
      headline: "No dimension can be assessed from eval evidence yet.",
    };
  }
  const worst = assessed.reduce((acc, d) =>
    RATING_RANK[d.rating] < RATING_RANK[acc.rating] ? d : acc,
  );
  // Name the dimension that set the verdict, so a reader knows where to look.
  const driver = `Weakest dimension: ${worst.title} (${RATING_LABEL[worst.rating]}).`;
  const headline =
    worst.rating === "strong"
      ? "On the evidence available today, the agent looks production-ready."
      : worst.rating === "adequate"
        ? `Workable, but with gaps a team should close before relying on it unsupervised. ${driver}`
        : worst.rating === "at-risk"
          ? `Not ready for unsupervised production use — the weakest dimension needs work. ${driver}`
          : `Not production-ready — a core dimension is failing. ${driver}`;
  return { rating: worst.rating, headline };
}

/**
 * Build a one-page AI Reliability Scorecard from a single eval run. Pure: no
 * clock, no I/O — the timestamp is carried from the eval result so the same
 * input always yields the same scorecard. Reliability and Cost discipline are
 * computed in Phase 1C; Observability from trace coverage in Phase 2D when
 * `opts.observability` is supplied; Guardrail coverage from the OWASP mapping in
 * Phase 3A when `opts.guardrails` is supplied; Governance readiness from the EU
 * AI Act module in Phase 3C when `opts.governance` is supplied.
 */
export function buildScorecard(result: EvalRunResult, opts: ScorecardOptions = {}): Scorecard {
  const stabilityFloor = opts.stabilityFloor ?? DEFAULT_STABILITY_FLOOR;

  const dimensions: Dimension[] = [
    reliabilityDimension(result, stabilityFloor),
    costDimension(result),
    opts.observability
      ? observabilityDimension(opts.observability)
      : stubDimension(
          "observability",
          "Observability coverage",
          "Phase 2D",
          "real OpenTelemetry trace coverage",
        ),
    opts.guardrails
      ? guardrailsDimension(opts.guardrails)
      : stubDimension(
          "guardrails",
          "Guardrail coverage",
          "Phase 3A",
          "the OWASP Agentic Top 10 mapping",
        ),
    opts.governance
      ? governanceDimension(opts.governance)
      : stubDimension(
          "governance",
          "Governance readiness",
          "Phase 3C",
          "the EU AI Act deployer module",
        ),
  ];

  return {
    generatedAt: result.timestamp,
    agentTask: opts.agentTask ?? DEFAULT_AGENT_TASK,
    provider: result.provider,
    model: result.model,
    degraded: opts.degraded ?? false,
    overall: overallVerdict(dimensions),
    dimensions,
    meta: {
      assessedCount: dimensions.filter((d) => d.assessed).length,
      totalDimensions: dimensions.length,
    },
  };
}
