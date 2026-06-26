#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-owasp-coverage
 *
 * The enforcing mechanism for the Phase 3A rule "no silent governance omissions"
 * (see docs/PLAN-Grade-Stack-v2.md → Enforcement-mechanism register). Fails the
 * build when the committed OWASP Agentic Top 10 mapping is incomplete or
 * internally inconsistent:
 *   1. every ASI01–ASI10 threat is present exactly once, each classified as
 *      covered / partial / gap, with covered/partial naming a mechanism, every
 *      partial/gap stating a residual gap, and every unscored (out-of-scope) item
 *      stating why (all enforced by `parseOwaspMapping`);
 *   2. the human-readable README names every threat id, so the machine-readable
 *      JSON and the prose mapping cannot drift apart.
 *
 * Wired into `bun run check`, which CI runs — so "covered-or-flagged" is enforced,
 * not aspirational. "Mechanisms, not prose": this script is what makes the OWASP
 * mapping binding. It delegates the shared load/parse/README/summary flow to
 * `checkGovernanceMapping` (ADR 0014) and owns only the OWASP-specific spec.
 */

import {
  computeGuardrailCoverage,
  OWASP_ASI_IDS,
  parseOwaspMapping,
} from "../packages/scorecard/src/owasp.ts";
import { checkGovernanceMapping } from "./check-governance-mapping.ts";

await checkGovernanceMapping({
  label: "OWASP coverage",
  jsonPath: "governance/owasp/owasp-agentic-top10-2026.json",
  readmePath: "governance/owasp/README.md",
  parse: parseOwaspMapping,
  requiredReadmeTokens: OWASP_ASI_IDS,
  summary: (mapping) => {
    const cov = computeGuardrailCoverage(mapping);
    return (
      `${mapping.taxonomy} (${mapping.version}): all ${mapping.items.length} threats classified ` +
      `(${cov.covered} covered, ${cov.partial} partial, ${cov.gaps} gap over ${cov.scoredCount} applicable; ` +
      `${cov.outOfScope} out of scope), README consistent.`
    );
  },
});
