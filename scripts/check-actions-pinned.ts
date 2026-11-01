#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-actions-pinned
 *
 * The enforcing mechanism for security finding 8: every GitHub Action a
 * workflow uses is pinned to a full 40-hex commit SHA, never a tag or branch.
 * A tag such as `actions/checkout@v4` moves; whoever controls it controls what
 * runs in CI with the repo's token. A SHA (with the tag in a trailing comment)
 * changes only when someone edits it here. Wired into `bun run check`, which CI
 * runs, so the pins cannot quietly slip back to tags.
 *
 * Local actions (`./path`) are exempt: they live in this repo. A `docker://`
 * image must be pinned by `@sha256:` digest.
 */

import { Glob } from "bun";

/** One `uses:` reference that is not pinned. */
export interface Unpinned {
  file: string;
  line: number;
  ref: string;
}

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** Return whether one `uses:` value is pinned (or exempt as a local action). */
export function isPinned(ref: string): boolean {
  if (ref.startsWith("./")) return true;
  if (ref.startsWith("docker://")) return DIGEST.test(ref);
  const at = ref.lastIndexOf("@");
  return at > 0 && SHA.test(ref.slice(at + 1));
}

/** Every unpinned `uses:` line in one workflow file's text. */
export function unpinnedUses(file: string, text: string): Unpinned[] {
  const out: Unpinned[] = [];
  text.split("\n").forEach((src, i) => {
    const m = USES.exec(src);
    if (m?.[1] && !isPinned(m[1])) out.push({ file, line: i + 1, ref: m[1] });
  });
  return out;
}

if (import.meta.main) {
  // `dot: true`: `.github` is a dot directory, which Glob skips by default.
  const scan = { cwd: ".", dot: true };
  const files = [
    ...new Glob(".github/workflows/*.yml").scanSync(scan),
    ...new Glob(".github/workflows/*.yaml").scanSync(scan),
  ].sort();
  // Fail closed: finding no workflows means the scan is broken, not that all is well.
  if (files.length === 0) {
    console.error("✖ actions pinned: no workflows found under .github/workflows; failing closed.");
    process.exit(1);
  }
  const bad: Unpinned[] = [];
  for (const file of files) {
    bad.push(...unpinnedUses(file, await Bun.file(file).text()));
  }
  if (bad.length > 0) {
    console.error(`✖ ${bad.length} workflow action(s) not pinned to a commit SHA:\n`);
    for (const b of bad) console.error(`  ${b.file}:${b.line}  ${b.ref}`);
    console.error("\nPin each as `owner/repo@<40-hex sha> # <tag>`.");
    process.exit(1);
  }
  console.log(`✓ actions pinned: every \`uses:\` in ${files.length} workflow(s) is a commit SHA.`);
}
