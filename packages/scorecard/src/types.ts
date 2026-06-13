// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * Plain-language ratings. Deliberately a short, board-legible scale — a CFO can
 * read "At risk" without a glossary. `not-assessed` is honest about dimensions
 * that no eval evidence supports yet (they land in later phases).
 */
export type Rating = "strong" | "adequate" | "at-risk" | "critical" | "not-assessed";

/**
 * Orders ratings worst→best for comparison (used to roll up an overall verdict
 * and to prove honest degradation). `not-assessed` has no rank — it is excluded
 * from the rollup rather than treated as good or bad.
 */
export const RATING_RANK: Record<Exclude<Rating, "not-assessed">, number> = {
  critical: 0,
  "at-risk": 1,
  adequate: 2,
  strong: 3,
};

/** Human label for each rating, for headers and tables. */
export const RATING_LABEL: Record<Rating, string> = {
  strong: "Strong",
  adequate: "Adequate",
  "at-risk": "At risk",
  critical: "Critical",
  "not-assessed": "Not yet assessed",
};

/** One executive dimension of the scorecard. */
export interface Dimension {
  /** Stable machine key, e.g. "reliability". */
  key: string;
  /** Display title, e.g. "Reliability". */
  title: string;
  rating: Rating;
  /** One plain-language sentence a non-technical reader can act on. */
  headline: string;
  /**
   * The eval evidence behind the rating — each line traces to numbers in the
   * eval results. No rating is allowed without evidence (the contract: no
   * unsupported scores). Stubbed dimensions carry the reason they're unassessed.
   */
  evidence: string[];
  /** False for dimensions that have no eval evidence yet (stubs). */
  assessed: boolean;
  /** For unassessed dimensions, the phase that computes them. */
  plannedPhase?: string;
}

/** A complete one-page scorecard built from a single eval run. */
export interface Scorecard {
  /** ISO timestamp carried from the eval run (not re-stamped here). */
  generatedAt: string;
  /** What was under test. */
  agentTask: string;
  provider: string;
  model: string;
  /** Cosmetic banner only — never an input to any rating (ratings are evidence-derived). */
  degraded: boolean;
  overall: {
    rating: Rating;
    headline: string;
  };
  dimensions: Dimension[];
  meta: {
    assessedCount: number;
    totalDimensions: number;
  };
}
