// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/release.test
 *
 * Tests the release manifest (Phase 4C, ADR 0018): the strict schema refuses a
 * malformed manifest loudly; hashes are stable under key order; a pre-4C eval
 * result with no manifest is refused rather than guessed at; and `diffReleases`
 * explains a prompt change, a model change and an added tool in one sentence.
 */

import { describe, expect, test } from "bun:test";
import {
  buildReleaseManifest,
  canonicalJson,
  diffReleases,
  hashOf,
  parseReleaseManifest,
  RELEASE_ATTRS,
  type ReleaseInput,
  ReleaseManifestError,
  ReleaseManifestSchema,
  readGitState,
  releaseFromJson,
  releaseSpanAttributes,
} from "./release.ts";

const GIT = { gitSha: "a".repeat(40), dirty: false };
const AT = new Date("2026-10-29T09:00:00.000Z");

function input(over: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    prompt: "You are a customer-support triage assistant.",
    model: "stub-deterministic-v1",
    provider: "stub",
    tools: [
      { name: "search_help_articles", argSchema: { type: "object", properties: { query: {} } } },
      { name: "lookup_account", argSchema: { type: "object", properties: { email: {} } } },
    ],
    policy: { maxTurns: 3, generation: { maxTokens: 800, temperature: 0 } },
    git: GIT,
    builtAt: AT,
    ...over,
  };
}

describe("release manifest schema", () => {
  test("a built manifest validates and sorts tools by name", () => {
    const m = buildReleaseManifest(input());
    expect(ReleaseManifestSchema.parse(m)).toEqual(m);
    expect(m.tools.map((t) => t.name)).toEqual(["lookup_account", "search_help_articles"]);
    expect(m.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.builtAt).toBe("2026-10-29T09:00:00.000Z");
  });

  test("malformed manifests fail loudly, naming the source and field", () => {
    const m = buildReleaseManifest(input());
    expect(() => parseReleaseManifest({ ...m, promptHash: "abc" }, "a.json")).toThrow(
      /a\.json: release manifest promptHash/,
    );
    expect(() => parseReleaseManifest({ ...m, gitSha: "main" }, "a.json")).toThrow(
      ReleaseManifestError,
    );
    expect(() => parseReleaseManifest({ ...m, extra: 1 }, "a.json")).toThrow(ReleaseManifestError);
    const { model: _model, ...noModel } = m;
    expect(() => parseReleaseManifest(noModel, "a.json")).toThrow(/model/);
  });

  test("hashes are stable under key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(hashOf({ b: 1, a: 2 })).toBe(hashOf({ a: 2, b: 1 }));
    expect(buildReleaseManifest(input({ policy: { b: 1, a: 2 } })).policyHash).toBe(
      buildReleaseManifest(input({ policy: { a: 2, b: 1 } })).policyHash,
    );
  });

  test("RELIABILITY_GIT_SHA names the code when there is no .git", () => {
    const sha = "b".repeat(40);
    expect(readGitState("/", { RELIABILITY_GIT_SHA: sha, RELIABILITY_GIT_DIRTY: "1" })).toEqual({
      gitSha: sha,
      dirty: true,
    });
  });

  test("releaseFromJson reads an eval result's release, or a bare manifest", () => {
    const m = buildReleaseManifest(input());
    expect(releaseFromJson({ summary: {}, release: m }, "r.json")).toEqual(m);
    expect(releaseFromJson(m, "m.json")).toEqual(m);
  });

  test("a pre-4C eval result with no manifest is refused, not guessed at", () => {
    expect(() => releaseFromJson({ summary: {}, cases: [] }, "old.json")).toThrow(
      /old\.json: this eval result carries no release manifest/,
    );
  });
});

describe("diffReleases", () => {
  test("a prompt change, an added tool and nothing else, in one sentence", () => {
    const a = buildReleaseManifest(input());
    const b = buildReleaseManifest(
      input({
        prompt: "You are a terse support triage assistant.",
        tools: [...input().tools, { name: "lookup_order", argSchema: { type: "object" } }],
      }),
    );
    const d = diffReleases(a, b);
    expect(d.changed).toBe(true);
    expect(d.prompt.changed).toBe(true);
    expect(d.model.changed).toBe(false);
    expect(d.tools.added).toEqual(["lookup_order"]);
    expect(d.sentence).toBe(
      "Prompt hash changed; model unchanged; tool `lookup_order` added; policy hash unchanged; code at aaaaaaa.",
    );
  });

  test("model, provider, policy, tool arguments and code changes are each named", () => {
    const a = buildReleaseManifest(input());
    const b = buildReleaseManifest(
      input({
        model: "claude-sonnet",
        provider: "bedrock",
        policy: { maxTurns: 5 },
        tools: [{ name: "lookup_account", argSchema: { type: "object", properties: { id: {} } } }],
        git: { gitSha: "c".repeat(40), dirty: true },
      }),
    );
    const s = diffReleases(a, b).sentence;
    expect(s).toContain("model changed from stub-deterministic-v1 to claude-sonnet");
    expect(s).toContain("provider changed from stub to bedrock");
    expect(s).toContain("tool `search_help_articles` removed");
    expect(s).toContain("tool `lookup_account` arguments changed");
    expect(s).toContain("policy hash changed");
    expect(s).toContain("code moved from aaaaaaa to ccccccc with uncommitted changes");
  });

  test("identical releases (bar builtAt) are unchanged", () => {
    const a = buildReleaseManifest(input());
    const b = buildReleaseManifest(input({ builtAt: new Date("2026-11-01T00:00:00Z") }));
    const d = diffReleases(a, b);
    expect(d.changed).toBe(false);
    expect(d.sentence).toStartWith("Prompt hash unchanged; model unchanged; tools unchanged");
  });
});

describe("releaseSpanAttributes", () => {
  test("carries every manifest field under grade_stack.release.*", () => {
    const m = buildReleaseManifest(input());
    const attrs = releaseSpanAttributes(m);
    expect(attrs[RELEASE_ATTRS.promptHash]).toBe(m.promptHash);
    expect(attrs[RELEASE_ATTRS.gitSha]).toBe(m.gitSha);
    expect(attrs[RELEASE_ATTRS.tools]).toEqual([
      `lookup_account@${m.tools[0]?.argSchemaHash.slice(0, 8)}`,
      `search_help_articles@${m.tools[1]?.argSchemaHash.slice(0, 8)}`,
    ]);
  });
});
