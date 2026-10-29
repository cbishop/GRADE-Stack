// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/types
 *
 * The scorecard's data model: the board-legible Rating scale, the five
 * GRADE-letter dimensions (ADR 0016), the two-state criterion union (computed
 * with a citation, or stubbed with the v3 sub-phase that fills it in), the
 * whole-card shape, and the rating rank/label tables.
 */

/**
 * Plain-language ratings. Deliberately a short, board-legible scale: a CFO can
 * read "At risk" without a glossary. `not-assessed` is honest about criteria
 * that no evidence supports yet (they land in later sub-phases).
 */
export type Rating = "strong" | "adequate" | "at-risk" | "critical" | "not-assessed";

/** A rating backed by evidence (every rating except `not-assessed`). */
export type AssessedRating = Exclude<Rating, "not-assessed">;

/**
 * Orders ratings worst to best for comparison (used to roll up the dimension
 * and overall verdicts and to prove honest degradation). `not-assessed` has no
 * rank: it is excluded from every rollup rather than treated as good or bad.
 */
export const RATING_RANK: Record<AssessedRating, number> = {
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

/** The five GRADE dimension ids, in letter order (ADR 0016). */
export const GRADE_DIMENSION_IDS = [
  "governed",
  "reliable",
  "agentic",
  "deployed",
  "evaluated",
] as const;

/** One of the five GRADE dimension ids. */
export type DimensionId = (typeof GRADE_DIMENSION_IDS)[number];

/** The letter each dimension is named for. */
export type GradeLetter = "G" | "R" | "A" | "D" | "E";

/**
 * The v3 sub-phases a stubbed criterion may name (PLAN v3). A stub must say
 * which of these fills it in; there is no open-ended "later".
 */
export const FILLS_IN_PHASES = ["4B", "4C", "4D", "4E", "4F"] as const;

/** One v3 sub-phase that fills in a stubbed criterion. */
export type FillsInPhase = (typeof FILLS_IN_PHASES)[number];

/**
 * Where a computed criterion's grade comes from: the record it was computed
 * from (file and id), the threshold applied, and what would change the grade.
 * PLAN v3 explainability rule 3.
 */
export interface EvidenceCitation {
  /** The record the grade was computed from, e.g. a results file or governance JSON. */
  source: string;
  /** The bands or floor applied to that record. */
  threshold: string;
  /** One sentence naming what would move the grade up (or down, when already Strong). */
  wouldChange: string;
}

/** One decision-log record, reduced to what the D criteria need (Phase 4B). */
export interface DecisionLogEntry {
  requestId: string;
  /** null when the record carries no caller id. */
  callerId: string | null;
  /** False while caller ids are self-asserted headers (4B); 4E authenticates them. */
  callerVerified: boolean;
  /** True when the request's content was captured for reconstruction. */
  contentCaptured: boolean;
}

/**
 * The gateway decision log the D criteria *attributable* and *reconstructable*
 * are computed from (Phase 4B, ADR 0017). Read and schema-validated by the CLI;
 * the scorecard stays pure.
 */
export interface DecisionLogEvidence {
  /** The decision log file, cited by both criteria. */
  source: string;
  records: DecisionLogEntry[];
  /** The logging and retention record and the retention period it states (null when not stated). */
  retention: { source: string; period: string | null };
}

/** The latest kill-switch drill, reduced to what *rollback verified* needs (Phase 4C). */
export interface DrillEvidenceRecord {
  /** UTC date of the drill. */
  date: string;
  startedAt: string;
  actor: string;
  /** Halt command to first refused request; null when the gateway never halted. */
  timeToHaltMs: number | null;
  /** The threshold the drill itself was run against. */
  thresholdMs: number;
  providerCallsAfterHalt: number;
  requestsRefused: number;
  probes: number;
  resumeRestored: boolean;
  /** The release that was running when the switch was pulled. */
  releaseGitSha: string;
}

/**
 * The kill-switch drill record D's *rollback verified* criterion is computed
 * from (Phase 4C, ADR 0018). Read and schema-validated by the CLI; the
 * scorecard stays pure, so the date the record's age is measured against is an
 * input too.
 */
export interface DrillEvidence {
  /** The drill record file cited, or the directory searched when it holds none. */
  source: string;
  /** null when no drill record exists. */
  record: DrillEvidenceRecord | null;
  /** ISO date-time the record's age is measured against (the CLI passes now, or `--as-of`). */
  asOf: string;
}

/** A criterion graded from evidence. */
export interface ComputedCriterion {
  state: "computed";
  /** Stable machine key, e.g. "reliability". */
  key: string;
  /** Display title, e.g. "Reliability". */
  title: string;
  rating: AssessedRating;
  /** One plain-language sentence a non-technical reader can act on. */
  headline: string;
  /** The numbers behind the rating; never empty. */
  evidence: string[];
  citation: EvidenceCitation;
}

/** A criterion with no evidence yet, honest about the sub-phase that fills it in. */
export interface StubbedCriterion {
  state: "stubbed";
  key: string;
  title: string;
  rating: "not-assessed";
  /** The v3 sub-phase that computes this criterion. */
  fillsIn: FillsInPhase;
  /** The record it will be computed from once that sub-phase ships. */
  computedFrom: string;
}

/**
 * Every criterion is in exactly one of two states (register row 4A: "Scorecard
 * cannot claim a letter it has no evidence for"). The union is closed: there is
 * no third state, and the scorecard tests assert it.
 */
export type Criterion = ComputedCriterion | StubbedCriterion;

/** One GRADE-letter dimension of the scorecard. */
export interface Dimension {
  id: DimensionId;
  letter: GradeLetter;
  /** Full name, e.g. "Governed". */
  title: string;
  /** The question the letter answers, in plain language. */
  question: string;
  /**
   * The weakest computed criterion's rating (ADR 0016). Stubs never move it;
   * `not-assessed` only when the dimension has no computed criterion.
   */
  rating: Rating;
  /** The weakest computed criterion's headline, so the reader sees what set the grade. */
  headline: string;
  /** The named criteria under this letter, computed ones first. */
  criteria: Criterion[];
  /** True when at least one criterion is computed. */
  assessed: boolean;
}

/** A complete one-page scorecard built from a single eval run. */
export interface Scorecard {
  /** ISO timestamp carried from the eval run (not re-stamped here). */
  generatedAt: string;
  /** What was under test. */
  agentTask: string;
  provider: string;
  model: string;
  /** Cosmetic banner only; never an input to any rating (ratings are evidence-derived). */
  degraded: boolean;
  overall: {
    rating: Rating;
    headline: string;
  };
  /** The five GRADE letters, in order. */
  dimensions: Dimension[];
  meta: {
    /** Letters with at least one computed criterion. */
    assessedCount: number;
    totalDimensions: number;
    computedCriteria: number;
    stubbedCriteria: number;
  };
}
