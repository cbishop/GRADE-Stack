// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/agent-manifest.test
 *
 * Schema and loader tests for the Phase 4E agent manifest (ADR 0020): a valid
 * manifest parses; a malformed one throws loudly with its file and field; the
 * level rules hold (an L0 agent declares no tools, an L1 agent requires
 * review); the file name must match the id; bearer tokens parse from
 * `RELIABILITY_AGENT_TOKENS` or a tokens file, a token for an agent with no
 * manifest refuses to start, and authentication resolves a known token, refuses
 * an unknown or missing one, and never echoes a token. The committed
 * `agents/triage.json` loads as L1.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentManifestError,
  AgentManifestSchema,
  AgentRegistry,
  loadAgentManifests,
  loadAgentRegistry,
  manifestPolicy,
  parseAgentManifest,
  parseAgentTokens,
  resolveAgentRegistryFromEnv,
  resolveAgentTokens,
  toolScope,
} from "./agent-manifest.ts";
import { DEFAULT_POLICY } from "./policy.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

const TRIAGE = {
  id: "triage",
  owner: "support-lead@example.com",
  autonomyLevel: "L1",
  allowedTools: ["lookup_account", "search_help_articles"],
  allowedModels: ["stub-deterministic"],
  maxTurns: 4,
  tokenCap: 800,
  reviewRequired: true,
};

const HELPDESK = {
  id: "helpdesk",
  owner: "kb-team@example.com",
  autonomyLevel: "L0",
  allowedTools: [],
  allowedModels: ["frontier-test-model"],
  maxTurns: 1,
  tokenCap: 200,
  reviewRequired: false,
};

const TRIAGE_TOKEN = "tok-triage-0123456789abcdef";
const HELPDESK_TOKEN = "tok-helpdesk-0123456789abcdef";

function dirWith(manifests: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), "grade-stack-agents-"));
  for (const m of manifests) {
    writeFileSync(join(dir, `${(m as { id: string }).id}.json`), JSON.stringify(m, null, 2));
  }
  return dir;
}

describe("AgentManifestSchema (4E)", () => {
  test("a valid manifest parses with every field", () => {
    const m = AgentManifestSchema.parse(TRIAGE);
    expect(m).toMatchObject({ id: "triage", autonomyLevel: "L1", maxTurns: 4, tokenCap: 800 });
  });

  test("malformed manifests throw loudly, naming the file and the field", () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ ...TRIAGE, autonomyLevel: "L4" }, "autonomyLevel"],
      [{ ...TRIAGE, maxTurns: 0 }, "maxTurns"],
      [{ ...TRIAGE, tokenCap: -1 }, "tokenCap"],
      [{ ...TRIAGE, allowedModels: [] }, "allowedModels"],
      [{ ...TRIAGE, owner: "" }, "owner"],
      [{ ...TRIAGE, extra: true }, "extra"],
      [{ ...TRIAGE, id: "has space" }, "id"],
    ];
    for (const [json, field] of bad) {
      expect(() => parseAgentManifest(json, "agents/triage.json")).toThrow(AgentManifestError);
      expect(() => parseAgentManifest(json, "agents/triage.json")).toThrow(
        new RegExp(`agents/triage\\.json: .*${field}`),
      );
    }
    const { owner: _owner, ...noOwner } = TRIAGE;
    expect(() => parseAgentManifest(noOwner, "agents/triage.json")).toThrow(/owner/);
  });

  test("an L0 agent (suggest only) may declare no tools", () => {
    expect(() =>
      parseAgentManifest({ ...HELPDESK, allowedTools: ["lookup_account"] }, "x.json"),
    ).toThrow(/L0/);
  });

  test("an L1 agent (act with approval) must require review", () => {
    expect(() => parseAgentManifest({ ...TRIAGE, reviewRequired: false }, "x.json")).toThrow(/L1/);
  });

  test("the reserved caller id anonymous cannot be an agent", () => {
    expect(() => parseAgentManifest({ ...HELPDESK, id: "anonymous" }, "x.json")).toThrow(
      /anonymous/,
    );
  });

  test("the loader reads agents/<id>.json and refuses a file whose name disagrees with its id", () => {
    const dir = dirWith([TRIAGE, HELPDESK]);
    const loaded = loadAgentManifests(dir);
    expect(loaded.map((l) => l.manifest.id).sort()).toEqual(["helpdesk", "triage"]);
    expect(loaded.find((l) => l.manifest.id === "triage")?.file).toBe(join(dir, "triage.json"));

    writeFileSync(join(dir, "other.json"), JSON.stringify({ ...TRIAGE, id: "billing" }));
    expect(() => loadAgentManifests(dir)).toThrow(/other\.json.*billing/);
  });

  test("a file that is not JSON fails loudly with its path", () => {
    const dir = dirWith([TRIAGE]);
    writeFileSync(join(dir, "broken.json"), "{ not json");
    expect(() => loadAgentManifests(dir)).toThrow(/broken\.json: not valid JSON/);
  });

  test("a missing manifests directory fails loudly rather than meaning no agents", () => {
    expect(() => loadAgentManifests(join(tmpdir(), "no-such-agents-dir-4e"))).toThrow(
      AgentManifestError,
    );
  });

  test("the committed agents/triage.json is the reference agent at L1", () => {
    const loaded = loadAgentManifests(join(repoRoot, "agents"));
    const triage = loaded.find((l) => l.manifest.id === "triage")?.manifest;
    expect(triage?.autonomyLevel).toBe("L1");
    expect(triage?.reviewRequired).toBe(true);
    expect(triage?.allowedTools).toContain("lookup_account");
  });
});

describe("bearer tokens and authentication (4E)", () => {
  test("tokens parse from id:token pairs, comma or newline separated, comments ignored", () => {
    const t = parseAgentTokens(
      `# agent tokens\ntriage:${TRIAGE_TOKEN}\n\nhelpdesk:${HELPDESK_TOKEN}\n`,
      "f",
    );
    expect(t.get("triage")).toBe(TRIAGE_TOKEN);
    expect(t.get("helpdesk")).toBe(HELPDESK_TOKEN);
    expect(parseAgentTokens(`triage:${TRIAGE_TOKEN},helpdesk:${HELPDESK_TOKEN}`, "env").size).toBe(
      2,
    );
  });

  test("a malformed token entry, a short token or a duplicate id throws without echoing the token", () => {
    for (const bad of [
      "triage",
      "triage:short",
      `triage:${TRIAGE_TOKEN},triage:${TRIAGE_TOKEN}x`,
    ]) {
      let message = "";
      try {
        parseAgentTokens(bad, "RELIABILITY_AGENT_TOKENS");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("RELIABILITY_AGENT_TOKENS");
      expect(message).not.toContain(TRIAGE_TOKEN);
      expect(message).not.toContain("short");
    }
  });

  test("tokens come from RELIABILITY_AGENT_TOKENS, else RELIABILITY_AGENT_TOKENS_FILE", () => {
    const file = join(mkdtempSync(join(tmpdir(), "grade-stack-tokens-")), "tokens");
    writeFileSync(file, `helpdesk:${HELPDESK_TOKEN}\n`);
    expect(resolveAgentTokens({ RELIABILITY_AGENT_TOKENS: `triage:${TRIAGE_TOKEN}` }).size).toBe(1);
    expect(resolveAgentTokens({ RELIABILITY_AGENT_TOKENS_FILE: file }).get("helpdesk")).toBe(
      HELPDESK_TOKEN,
    );
  });

  test("a token for an agent with no manifest refuses to start; so do manifests with no tokens", () => {
    const dir = dirWith([TRIAGE]);
    expect(() =>
      loadAgentRegistry(dir, { RELIABILITY_AGENT_TOKENS: `ghost:${TRIAGE_TOKEN}` }),
    ).toThrow(/ghost/);
    expect(() => loadAgentRegistry(dir, {})).toThrow(/no agent tokens/);
  });

  test("authenticate resolves a known token and refuses unknown, missing or malformed ones", () => {
    const dir = dirWith([TRIAGE, HELPDESK]);
    const reg = loadAgentRegistry(dir, {
      RELIABILITY_AGENT_TOKENS: `triage:${TRIAGE_TOKEN},helpdesk:${HELPDESK_TOKEN}`,
    });
    expect(reg).toBeInstanceOf(AgentRegistry);
    const ok = reg.authenticate(`Bearer ${TRIAGE_TOKEN}`);
    expect(ok.ok && ok.agent.manifest.id).toBe("triage");
    expect(reg.authenticate(`bearer ${HELPDESK_TOKEN}`)).toMatchObject({ ok: true });

    const unknown = reg.authenticate("Bearer tok-nobody-0123456789abcdef");
    expect(unknown).toMatchObject({ ok: false });
    expect(!unknown.ok && unknown.reason).toContain("unknown bearer token");
    expect(!unknown.ok && unknown.reason).not.toContain("tok-nobody");
    expect(reg.authenticate(null)).toMatchObject({ ok: false, reason: "no bearer token" });
    expect(reg.authenticate(`Basic ${TRIAGE_TOKEN}`)).toMatchObject({ ok: false });
    // A prefix of a real token is not that token.
    expect(reg.authenticate(`Bearer ${TRIAGE_TOKEN.slice(0, -1)}`)).toMatchObject({ ok: false });
  });

  test("no RELIABILITY_AGENTS_DIR means no registry: v2 single-agent behaviour", () => {
    expect(resolveAgentRegistryFromEnv({})).toBeNull();
    const dir = dirWith([TRIAGE]);
    const reg = resolveAgentRegistryFromEnv({
      RELIABILITY_AGENTS_DIR: dir,
      RELIABILITY_AGENT_TOKENS: `triage:${TRIAGE_TOKEN}`,
    });
    expect(reg?.get("triage")?.manifest.autonomyLevel).toBe("L1");
  });
});

describe("per-agent policy and tool scope (4E)", () => {
  test("the per-request policy is the manifest on top of DEFAULT_POLICY", () => {
    const m = AgentManifestSchema.parse(TRIAGE);
    const p = manifestPolicy(DEFAULT_POLICY, m);
    expect(p.allowedModels).toEqual(["stub-deterministic"]);
    expect(p.maxTokens).toBe(800);
    // A manifest cannot raise the gateway-wide cap.
    expect(manifestPolicy(DEFAULT_POLICY, { ...m, tokenCap: 100_000 }).maxTokens).toBe(
      DEFAULT_POLICY.maxTokens,
    );
  });

  test("toolScope allows only declared tools and says why it refuses", () => {
    const triage = AgentManifestSchema.parse({ ...TRIAGE, allowedTools: ["lookup_account"] });
    const helpdesk = AgentManifestSchema.parse(HELPDESK);
    expect(toolScope(triage, "lookup_account")).toEqual({ allowed: true });
    const undeclared = toolScope(triage, "search_help_articles");
    expect(undeclared.allowed).toBe(false);
    expect(!undeclared.allowed && undeclared.reason).toContain("not declared");
    const l0 = toolScope(helpdesk, "lookup_account");
    expect(!l0.allowed && l0.reason).toContain("L0");
  });
});
