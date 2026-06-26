#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-nist-coverage
 *
 * Enforcing mechanism for the Phase 3B NIST AI RMF mapping (see
 * docs/PLAN-Grade-Stack-v2.md → Enforcement-mechanism register). Fails the build
 * when the committed NIST mapping is incomplete or internally inconsistent:
 *   1. every one of the 19 AI RMF 1.0 categories (GOVERN 1–6, MAP 1–5,
 *      MEASURE 1–4, MANAGE 1–4) is present exactly once, classified
 *      supported / partial / deployer-owned, with supported/partial naming a
 *      mechanism and every category stating its responsibility-boundary note
 *      (all enforced by `parseNistMapping`'s Zod schema — ADR 0014, replacing the
 *      previously hand-rolled validation here);
 *   2. the human-readable README names every function and category id, so the
 *      machine-readable JSON and the prose mapping cannot drift apart.
 *
 * Wired into `bun run check`, which CI runs. "Mechanisms, not prose": this is what
 * makes the NIST mapping's honesty binding. It delegates the shared flow to
 * `checkGovernanceMapping` and owns only the NIST-specific spec.
 */

import { NIST_FUNCTIONS, NIST_RMF_IDS, parseNistMapping } from "../packages/scorecard/src/nist.ts";
import { checkGovernanceMapping } from "./check-governance-mapping.ts";

await checkGovernanceMapping({
  label: "NIST coverage",
  jsonPath: "governance/nist/nist-ai-rmf-1.0-mapping.json",
  readmePath: "governance/nist/README.md",
  parse: parseNistMapping,
  requiredReadmeTokens: [...NIST_FUNCTIONS, ...NIST_RMF_IDS],
  summary: (mapping) => {
    const counts = (["supported", "partial", "deployer-owned"] as const)
      .map((s) => `${mapping.items.filter((c) => c.status === s).length} ${s}`)
      .join(", ");
    return `AI RMF 1.0: all ${mapping.items.length} categories classified (${counts}), README consistent.`;
  },
});
