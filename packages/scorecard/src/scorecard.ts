// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/scorecard
 *
 * Builds the AI Reliability Scorecard from a single eval run — mapping eval
 * evidence to executive dimensions (Reliability and Cost discipline computed in
 * Phase 1C; the rest honestly stubbed). Pure: no clock, no I/O.
 */

import { type CaseResult, type EvalRunResult, priceFor } from "@grade-stack/evals";
import type { Dimension, Rating, Scorecard } from "./types.ts";
import { RATING_RANK } from "./types.ts";

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

/**
 * Reliability — does the agent do its job? Derived from the pass rate, with a
 * flakiness guard: a barely-stable pass rate is downgraded one band.
 */
function reliabilityDimension(result: EvalRunResult, stabilityFloor: number): Dimension {
  const { summary } = result;
  let rating = reliabilityBand(summary.passRate);
  const flaky = summary.meanStability < stabilityFloor;
  if (flaky && rating !== "critical") rating = downgrade(rating);

  const headline =
    rating === "strong"
      ? "The agent handles its task dependably across the test suite."
      : rating === "adequate"
        ? "The agent usually succeeds, but a meaningful share of cases fail."
        : rating === "at-risk"
          ? "The agent fails too often to rely on without supervision."
          : "The agent fails the majority of cases — not fit for production.";

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

  const headline =
    rating === "strong"
      ? "Almost every dollar spent produces a usable result."
      : rating === "adequate"
        ? "Most spend is productive, but failures add a real tax to each success."
        : rating === "at-risk"
          ? "A large share of spend produces nothing usable."
          : "Spend is mostly wasted — there is little or no successful output to pay for.";

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
  const headline =
    worst.rating === "strong"
      ? "On the evidence available today, the agent looks production-ready."
      : worst.rating === "adequate"
        ? "Workable, but with gaps a team should close before relying on it unsupervised."
        : worst.rating === "at-risk"
          ? "Not ready for unsupervised production use — the weakest dimension needs work."
          : "Not production-ready — a core dimension is failing.";
  return { rating: worst.rating, headline };
}

/**
 * Build a one-page AI Reliability Scorecard from a single eval run. Pure: no
 * clock, no I/O — the timestamp is carried from the eval result so the same
 * input always yields the same scorecard. Only Reliability and Cost discipline
 * are computed in Phase 1C; the remaining three are honestly stubbed until the
 * phases that produce their evidence.
 */
export function buildScorecard(result: EvalRunResult, opts: ScorecardOptions = {}): Scorecard {
  const stabilityFloor = opts.stabilityFloor ?? DEFAULT_STABILITY_FLOOR;

  const dimensions: Dimension[] = [
    reliabilityDimension(result, stabilityFloor),
    costDimension(result),
    stubDimension(
      "observability",
      "Observability coverage",
      "Phase 2D",
      "real OpenTelemetry trace coverage",
    ),
    stubDimension(
      "guardrails",
      "Guardrail coverage",
      "Phase 3A",
      "the OWASP Agentic Top 10 mapping",
    ),
    stubDimension(
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
