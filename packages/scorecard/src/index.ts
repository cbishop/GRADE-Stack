// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard
 *
 * Public surface of the scorecard package: buildScorecard, the Markdown/HTML/
 * CLI renderers, and the scorecard types (GRADE letters and two-state criteria).
 */

export {
  computeGovernanceReadiness,
  type EuAiActModule,
  type EuAiActObligation,
  type GovernanceReadiness,
  parseEuAiActModule,
  type StackSupport,
} from "./eu-ai-act.ts";
export {
  NIST_FUNCTIONS,
  NIST_RMF_IDS,
  type NistCategory,
  type NistMapping,
  type NistSupport,
  parseNistMapping,
} from "./nist.ts";
export {
  type CoverageStatus,
  computeGuardrailCoverage,
  type GuardrailCoverage,
  OWASP_ASI_IDS,
  type OwaspItem,
  type OwaspMapping,
  parseOwaspMapping,
} from "./owasp.ts";
export { renderCli, renderHtml, renderMarkdown } from "./render.ts";
export { buildScorecard, type ScorecardOptions } from "./scorecard.ts";
export {
  type AssessedRating,
  type ComputedCriterion,
  type Criterion,
  type Dimension,
  type DimensionId,
  type EvidenceCitation,
  FILLS_IN_PHASES,
  type FillsInPhase,
  GRADE_DIMENSION_IDS,
  type GradeLetter,
  RATING_LABEL,
  RATING_RANK,
  type Rating,
  type Scorecard,
  type StubbedCriterion,
} from "./types.ts";
