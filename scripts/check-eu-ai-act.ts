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
 * keeps the EU AI Act readout honest and in-sync. It owns only this check.
 */

import { parseEuAiActModule } from "../packages/scorecard/src/eu-ai-act.ts";

const JSON_PATH = "governance/eu-ai-act/eu-ai-act-deployer-2026.json";
const README_PATH = "governance/eu-ai-act/README.md";

function fail(message: string): never {
  console.error(`✖ EU AI Act check failed — ${message}`);
  console.error('\nSee docs/PLAN-Grade-Stack-v2.md → "Enforcement-mechanism register".');
  process.exit(1);
}

let mod: ReturnType<typeof parseEuAiActModule>;
try {
  mod = parseEuAiActModule(await Bun.file(JSON_PATH).json());
} catch (err) {
  fail(`${JSON_PATH}: ${err instanceof Error ? err.message : String(err)}`);
}

// The credibility-critical facts that must survive into the human-readable readout.
const readme = await Bun.file(README_PATH).text();
const required = [
  mod.regulation, // "Regulation (EU) 2024/1689"
  "Digital Omnibus",
  "2026-08-02",
  "€35", // Tier 1 cap
  "€15", // Tier 2 cap
  "€7.5", // Tier 3 cap
];
const missing = required.filter((t) => !readme.includes(t));
if (missing.length > 0) {
  fail(`${README_PATH} is missing credibility-critical facts: ${missing.join(", ")}`);
}
if (
  !/not legal advice|not a compliance certificate|legal compliance is the deploy|compliance is the deploy/i.test(
    readme,
  )
) {
  fail(
    `${README_PATH} must state that the readout is not legal compliance (deployer's responsibility)`,
  );
}

const scored = mod.obligations.filter((o) => o.scored);
console.log(
  `✓ EU AI Act check passed — ${mod.regulation} (deployer lens): ${mod.obligations.length} obligations ` +
    `(${scored.length} scored), 3 penalty tiers intact, README states the re-verified facts.`,
);
