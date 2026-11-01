// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-actions-pinned.test
 *
 * Proves the Actions-pinning check (security finding 8) bites: a tag, a branch
 * or a short SHA fails it, a full 40-hex SHA with a trailing tag comment
 * passes, local actions are exempt, and a docker image needs a digest.
 */

import { describe, expect, test } from "bun:test";
import { isPinned, unpinnedUses } from "./check-actions-pinned.ts";

const SHA = "11d5960a326750d5838078e36cf38b85af677262";

describe("check-actions-pinned", () => {
  test("a tag, a branch or a short SHA is not pinned", () => {
    expect(isPinned("actions/checkout@v4")).toBe(false);
    expect(isPinned("actions/checkout@main")).toBe(false);
    expect(isPinned("actions/checkout@11d5960")).toBe(false);
    expect(isPinned("actions/checkout")).toBe(false);
  });

  test("a full SHA, a local action and a docker digest are pinned", () => {
    expect(isPinned(`actions/checkout@${SHA}`)).toBe(true);
    expect(isPinned("./.github/actions/setup")).toBe(true);
    expect(isPinned("docker://alpine:3")).toBe(false);
    expect(isPinned(`docker://alpine@sha256:${"a".repeat(64)}`)).toBe(true);
  });

  test("scans a workflow and reports each unpinned line", () => {
    const yml = [
      "steps:",
      `  - uses: actions/checkout@${SHA} # v4`,
      "  - uses: oven-sh/setup-bun@v2",
      "  - name: scan",
      '    uses: "gitleaks/gitleaks-action@v2"',
    ].join("\n");
    expect(unpinnedUses("ci.yml", yml)).toEqual([
      { file: "ci.yml", line: 3, ref: "oven-sh/setup-bun@v2" },
      { file: "ci.yml", line: 5, ref: "gitleaks/gitleaks-action@v2" },
    ]);
  });
});
