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
 *      supported / partial / deployer-owned;
 *   2. every `supported`/`partial` category names at least one mechanism, and
 *      every category states a responsibility-boundary note (so coverage is never
 *      claimed without evidence and the boundary is never left implicit);
 *   3. the human-readable README names every function and category id, so the
 *      machine-readable JSON and the prose mapping cannot drift apart.
 *
 * Self-contained (no imports beyond Bun) and wired into `bun run check`, which CI
 * runs. "Mechanisms, not prose": this is what makes the NIST mapping's honesty
 * binding rather than aspirational. It owns only this check; it never rewrites it.
 */

const JSON_PATH = "governance/nist/nist-ai-rmf-1.0-mapping.json";
const README_PATH = "governance/nist/README.md";

const EXPECTED_IDS = [
  "GOVERN 1",
  "GOVERN 2",
  "GOVERN 3",
  "GOVERN 4",
  "GOVERN 5",
  "GOVERN 6",
  "MAP 1",
  "MAP 2",
  "MAP 3",
  "MAP 4",
  "MAP 5",
  "MEASURE 1",
  "MEASURE 2",
  "MEASURE 3",
  "MEASURE 4",
  "MANAGE 1",
  "MANAGE 2",
  "MANAGE 3",
  "MANAGE 4",
];
const FUNCTIONS = ["GOVERN", "MAP", "MEASURE", "MANAGE"];
const STATUSES = ["supported", "partial", "deployer-owned"];

interface Item {
  id?: unknown;
  function?: unknown;
  title?: unknown;
  status?: unknown;
  mechanisms?: unknown;
  note?: unknown;
}

function fail(message: string): never {
  console.error(`✖ NIST coverage check failed — ${message}`);
  console.error('\nSee docs/PLAN-Grade-Stack-v2.md → "Enforcement-mechanism register".');
  process.exit(1);
}

const raw = (await Bun.file(JSON_PATH)
  .json()
  .catch((err) => fail(`${JSON_PATH}: ${err instanceof Error ? err.message : String(err)}`))) as {
  items?: Item[];
};

const items = raw.items;
if (!Array.isArray(items)) {
  fail(`${JSON_PATH}: "items" must be an array`);
}

const seen = new Set<string>();
for (const it of items) {
  const id = typeof it.id === "string" ? it.id : "(missing id)";
  if (!FUNCTIONS.includes(it.function as string)) {
    fail(`${id}: function must be one of ${FUNCTIONS.join(", ")}`);
  }
  if (!STATUSES.includes(it.status as string)) {
    fail(`${id}: status must be one of ${STATUSES.join(", ")}`);
  }
  if (typeof it.note !== "string" || it.note.trim() === "") {
    fail(`${id}: every category must state a responsibility-boundary note`);
  }
  const mechanisms = Array.isArray(it.mechanisms) ? it.mechanisms : [];
  if ((it.status === "supported" || it.status === "partial") && mechanisms.length < 1) {
    fail(`${id}: a "${it.status}" category must name at least one mechanism`);
  }
  seen.add(id);
}

const missing = EXPECTED_IDS.filter((id) => !seen.has(id));
if (missing.length > 0) {
  fail(`missing AI RMF categories: ${missing.join(", ")} (no silent omissions)`);
}
if (seen.size !== EXPECTED_IDS.length || items.length !== EXPECTED_IDS.length) {
  fail(`expected exactly ${EXPECTED_IDS.length} categories, found ${items.length}`);
}

// Cross-check: the README must name every function and category id, so the prose
// can't quietly omit a category the JSON classifies.
const readme = await Bun.file(README_PATH).text();
const missingFromReadme = [...FUNCTIONS, ...EXPECTED_IDS].filter(
  (token) => !readme.includes(token),
);
if (missingFromReadme.length > 0) {
  fail(
    `${README_PATH} does not mention: ${missingFromReadme.join(", ")} (machine/human mapping drift)`,
  );
}

const counts = STATUSES.map((s) => `${items.filter((it) => it.status === s).length} ${s}`).join(
  ", ",
);
console.log(
  `✓ NIST coverage check passed — AI RMF 1.0: all ${items.length} categories classified (${counts}), README consistent.`,
);
