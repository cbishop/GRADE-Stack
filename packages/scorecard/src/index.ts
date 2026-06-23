// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard
 *
 * Public surface of the scorecard package — buildScorecard, the Markdown/HTML/
 * CLI renderers, and the scorecard types.
 */

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
  type Dimension,
  RATING_LABEL,
  RATING_RANK,
  type Rating,
  type Scorecard,
} from "./types.ts";
