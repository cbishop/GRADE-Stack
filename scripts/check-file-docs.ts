#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-file-docs
 *
 * The enforcing mechanism for the Phase 1D source-file documentation convention
 * (see docs/PLAN-Grade-Stack-v2.md → "Source-file conventions"). Fails the build
 * when any TypeScript source file under `packages/*` or `reference-agent` lacks
 * its SPDX header or its file-level `@module` documentation block. Wired into
 * `bun run check`, which CI runs — so the rule is enforced, not aspirational.
 *
 * "Mechanisms, not prose": this script is what makes the per-file documentation
 * convention binding. It owns only this check; it never rewrites files.
 */

import { Glob } from "bun";

const ROOTS = ["packages/*/src/**/*.ts", "reference-agent/src/**/*.ts"];
// Headers and the lead doc block live at the very top; scan only that far.
const HEAD_LINES = 40;

interface Violation {
  file: string;
  problems: string[];
}

/** Return the list of convention problems for one file (empty = compliant). */
function problemsFor(source: string): string[] {
  const head = source.split("\n").slice(0, HEAD_LINES).join("\n");
  const problems: string[] = [];
  if (!/Copyright \d{4}/.test(head)) {
    problems.push("missing the copyright header line");
  }
  if (!/SPDX-License-Identifier:/.test(head)) {
    problems.push("missing the SPDX-License-Identifier header line");
  }
  if (!/@module\s+\S/.test(head)) {
    problems.push('missing a file-level "@module <name>" documentation block');
  }
  return problems;
}

const files: string[] = [];
for (const pattern of ROOTS) {
  for (const file of new Glob(pattern).scanSync(".")) {
    files.push(file);
  }
}
files.sort((a, b) => a.localeCompare(b));

const violations: Violation[] = [];
for (const file of files) {
  const problems = problemsFor(await Bun.file(file).text());
  if (problems.length > 0) {
    violations.push({ file, problems });
  }
}

if (violations.length > 0) {
  console.error(
    "✖ file-doc check failed — every .ts source file needs an SPDX header and an @module block.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const p of v.problems) {
      console.error(`    - ${p}`);
    }
  }
  console.error(
    `\n${violations.length} of ${files.length} file(s) need attention. ` +
      'See docs/PLAN-Grade-Stack-v2.md → "Source-file conventions".',
  );
  process.exit(1);
}

console.log(
  `✓ file-doc check passed — ${files.length} TypeScript files carry an SPDX header and an @module block.`,
);
