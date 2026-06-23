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
 *      covered / partial / gap, with covered/partial naming a mechanism and
 *      partial/gap stating a residual gap (enforced by `parseOwaspMapping`);
 *   2. the human-readable README names every threat id, so the machine-readable
 *      JSON and the prose mapping cannot drift apart.
 *
 * Wired into `bun run check`, which CI runs — so "covered-or-flagged" is enforced,
 * not aspirational. "Mechanisms, not prose": this script is what makes the OWASP
 * mapping binding. It owns only this check; it never rewrites the mapping.
 */

import { OWASP_ASI_IDS, parseOwaspMapping } from "../packages/scorecard/src/owasp.ts";

const JSON_PATH = "governance/owasp/owasp-agentic-top10-2026.json";
const README_PATH = "governance/owasp/README.md";

function fail(message: string): never {
  console.error(`✖ OWASP coverage check failed — ${message}`);
  console.error('\nSee docs/PLAN-Grade-Stack-v2.md → "Enforcement-mechanism register".');
  process.exit(1);
}

let mapping: ReturnType<typeof parseOwaspMapping>;
try {
  const raw = await Bun.file(JSON_PATH).json();
  mapping = parseOwaspMapping(raw);
} catch (err) {
  fail(`${JSON_PATH}: ${err instanceof Error ? err.message : String(err)}`);
}

// Cross-check: the human-readable mapping must mention every threat id, so the
// prose can't quietly omit an item the JSON covers.
const readme = await Bun.file(README_PATH).text();
const missingFromReadme = OWASP_ASI_IDS.filter((id) => !readme.includes(id));
if (missingFromReadme.length > 0) {
  fail(
    `${README_PATH} does not mention: ${missingFromReadme.join(", ")} (machine/human mapping drift)`,
  );
}

const covered = mapping.items.filter((it) => it.status === "covered").length;
const partial = mapping.items.filter((it) => it.status === "partial").length;
const gaps = mapping.items.filter((it) => it.status === "gap").length;

console.log(
  `✓ OWASP coverage check passed — ${mapping.taxonomy} (${mapping.version}): ` +
    `all ${mapping.items.length} threats classified (${covered} covered, ${partial} partial, ${gaps} gap), ` +
    `README consistent.`,
);
