#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-eu-ai-act
 *
 * Enforcing mechanism for the Phase 3C EU AI Act deployer readout (see
 * docs/PLAN-Grade-Stack-v2.md → Enforcement-mechanism register). Fails the build
 * when the committed module is structurally dishonest or the human-readable
 * readout drifts from the credibility-critical facts:
 *   1. the module validates against the same Zod schema the scorecard uses
 *      (`parseEuAiActModule`): every obligation carries owner/applicability/
 *      penalty-tier/note, and a scored supported/partial obligation names a
 *      mechanism — no readiness without evidence;
 *   2. the README states the re-verified facts a deployer relies on: the
 *      regulation, the Digital Omnibus, the 2026-08-02 date, all three penalty
 *      caps (so the tiers are never conflated away), and the readiness≠compliance
 *      caveat.
 *
 * Wired into `bun run check`, which CI runs. "Mechanisms, not prose": this is what
 * keeps the EU AI Act readout honest and in-sync. It delegates the shared flow to
 * `checkGovernanceMapping` (ADR 0014) and owns only the EU-specific spec.
 */

import { parseEuAiActModule } from "../packages/scorecard/src/eu-ai-act.ts";
import { checkGovernanceMapping } from "./check-governance-mapping.ts";

// Re-parse to read the regulation id for the required-token list (cheap; the
// runner re-reads + validates the file itself — this just sources one fact).
const mod = parseEuAiActModule(
  await Bun.file("governance/eu-ai-act/eu-ai-act-deployer-2026.json").json(),
);

await checkGovernanceMapping({
  label: "EU AI Act",
  jsonPath: "governance/eu-ai-act/eu-ai-act-deployer-2026.json",
  readmePath: "governance/eu-ai-act/README.md",
  parse: parseEuAiActModule,
  requiredReadmeTokens: [
    mod.regulation, // "Regulation (EU) 2024/1689"
    "Digital Omnibus",
    "2026-08-02",
    "€35", // Tier 1 cap
    "€15", // Tier 2 cap
    "€7.5", // Tier 3 cap
  ],
  extraReadmeCheck: (readme) =>
    /not legal advice|not a compliance certificate|legal compliance is the deploy|compliance is the deploy/i.test(
      readme,
    )
      ? null
      : "must state that the readout is not legal compliance (deployer's responsibility)",
  summary: (m) => {
    const scored = m.obligations.filter((o) => o.scored);
    return (
      `${m.regulation} (deployer lens): ${m.obligations.length} obligations ` +
      `(${scored.length} scored), 3 penalty tiers intact, README states the re-verified facts.`
    );
  },
});
