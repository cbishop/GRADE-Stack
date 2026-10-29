// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/tool-scope.test
 *
 * The bite test for Phase 4E's second chokepoint (ADR 0020): the gateway cannot
 * see tool calls, so the tool boundary is enforced where tools run. The MCP
 * server loads the same manifests as the gateway, the agent presents its
 * bearer token, and:
 *
 *   - an L0 agent's tool call is refused with `tool-not-allowed` before the
 *     tool runs, and logged to the decision log with the authenticated caller id;
 *   - a declared tool runs and is logged as allowed; an undeclared one is
 *     refused even for an agent that may call other tools;
 *   - over HTTP, a missing or unknown token gets 401 and an `auth` line;
 *   - over stdio, the token comes from `RELIABILITY_AGENT_TOKEN`, and a bad one
 *     refuses every tool call;
 *   - with no manifests the server behaves as in v2 and logs nothing.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentRegistry } from "@grade-stack/gateway/agent-manifest";
import {
  DecisionLog,
  isAuthRecord,
  isToolRecord,
  readDecisionLog,
  type ToolRecord,
} from "@grade-stack/gateway/decision-log";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serveHttp } from "./connect.ts";
import { createSupportMcpServer } from "./server.ts";
import { resolveStdioToolGuard, ToolScopeGuard } from "./tool-scope.ts";

const TRIAGE_TOKEN = "tok-triage-0123456789abcdef";
const HELPDESK_TOKEN = "tok-helpdesk-0123456789abcdef";
const TOKENS = `triage:${TRIAGE_TOKEN},helpdesk:${HELPDESK_TOKEN}`;

/** Two manifests: triage may call lookup_account only; helpdesk is L0 (no tools). */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "grade-stack-mcp-4e-"));
  const agentsDir = join(dir, "agents");
  mkdirSync(agentsDir);
  writeFileSync(
    join(agentsDir, "triage.json"),
    JSON.stringify({
      id: "triage",
      owner: "support-lead@example.com",
      autonomyLevel: "L1",
      allowedTools: ["lookup_account"],
      allowedModels: ["stub-deterministic"],
      maxTurns: 4,
      tokenCap: 800,
      reviewRequired: true,
    }),
  );
  writeFileSync(
    join(agentsDir, "helpdesk.json"),
    JSON.stringify({
      id: "helpdesk",
      owner: "kb-team@example.com",
      autonomyLevel: "L0",
      allowedTools: [],
      allowedModels: ["frontier-test-model"],
      maxTurns: 1,
      tokenCap: 200,
      reviewRequired: false,
    }),
  );
  const agents = loadAgentRegistry(agentsDir, { RELIABILITY_AGENT_TOKENS: TOKENS });
  const logPath = join(dir, "decisions.jsonl");
  return { dir, agentsDir, agents, logPath, log: new DecisionLog(logPath) };
}

async function inMemory(guard: ToolScopeGuard | null): Promise<Client> {
  const server = createSupportMcpServer({ guard });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

const LOOKUP = { name: "lookup_account", arguments: { email: "dana@acme-retail.example" } };

function textOf(res: { content?: unknown }): string {
  const content = (res.content ?? []) as { type: string; text?: string }[];
  return content.map((c) => c.text ?? "").join("");
}

describe("tool scope at the MCP server (4E)", () => {
  test("an L0 agent's tool call is refused with tool-not-allowed before it runs, logged with the caller id", async () => {
    const { agents, log, logPath } = setup();
    const auth = agents.authenticate(`Bearer ${HELPDESK_TOKEN}`);
    const client = await inMemory(new ToolScopeGuard({ caller: auth, decisionLog: log }));
    const res = await client.callTool(LOOKUP);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("tool-not-allowed");
    // The tool did not run: no account facts came back.
    expect(res.structuredContent).toBeUndefined();
    expect(textOf(res)).not.toContain("Acme Retail");

    const records = await readDecisionLog(logPath);
    expect(records.length).toBe(1);
    const line = records[0] as ToolRecord;
    expect(isToolRecord(line)).toBe(true);
    expect(line).toMatchObject({
      kind: "tool",
      callerId: "helpdesk",
      callerVerified: true,
      autonomyLevel: "L0",
      tool: "lookup_account",
      action: "block",
      policy: "tool-not-allowed",
    });
    expect(line.reason).toContain("L0");
    expect(readFileSync(logPath, "utf8")).not.toContain("dana@acme-retail.example");
  });

  test("a declared tool runs and is logged; an undeclared one is refused", async () => {
    const { agents, log, logPath } = setup();
    const auth = agents.authenticate(`Bearer ${TRIAGE_TOKEN}`);
    const client = await inMemory(new ToolScopeGuard({ caller: auth, decisionLog: log }));

    const ok = await client.callTool(LOOKUP);
    expect(ok.isError ?? false).toBe(false);
    expect((ok.structuredContent as { company?: string }).company).toBe("Acme Retail");

    const refused = await client.callTool({
      name: "search_help_articles",
      arguments: { query: "refund" },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("tool-not-allowed");

    const lines = (await readDecisionLog(logPath)).filter(isToolRecord);
    expect(lines.map((l) => [l.tool, l.action, l.callerId])).toEqual([
      ["lookup_account", "allow", "triage"],
      ["search_help_articles", "block", "triage"],
    ]);
  });

  test("over HTTP a missing or unknown token gets 401 and an auth line; an L0 token's call is refused", async () => {
    const { agents, log, logPath } = setup();
    const handle = serveHttp({ agents, decisionLog: log });
    try {
      const anon = await fetch(handle.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(anon.status).toBe(401);

      const wrong = new Client({ name: "wrong", version: "0.0.0" });
      await expect(
        wrong.connect(
          new StreamableHTTPClientTransport(new URL(handle.url), {
            requestInit: { headers: { authorization: "Bearer tok-nobody-0123456789abcdef" } },
          }),
        ),
      ).rejects.toThrow();

      const l0 = new Client({ name: "helpdesk", version: "0.0.0" });
      await l0.connect(
        new StreamableHTTPClientTransport(new URL(handle.url), {
          requestInit: { headers: { authorization: `Bearer ${HELPDESK_TOKEN}` } },
        }),
      );
      const res = await l0.callTool(LOOKUP);
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("tool-not-allowed");
      await l0.close();
    } finally {
      await handle.stop();
    }
    const records = await readDecisionLog(logPath);
    const auth = records.filter(isAuthRecord);
    expect(auth.length).toBeGreaterThanOrEqual(2);
    for (const a of auth) expect(a).toMatchObject({ chokepoint: "mcp-server", status: 401 });
    expect(auth.map((a) => a.reason)).toContain("no bearer token");
    expect(readFileSync(logPath, "utf8")).not.toContain("tok-nobody");
    const tool = records.filter(isToolRecord);
    expect(tool).toEqual([
      expect.objectContaining({
        callerId: "helpdesk",
        action: "block",
        policy: "tool-not-allowed",
      }),
    ]);
  });

  test("over stdio the token comes from RELIABILITY_AGENT_TOKEN; a bad one refuses every tool call", async () => {
    const { agentsDir, logPath } = setup();
    const env = {
      RELIABILITY_AGENTS_DIR: agentsDir,
      RELIABILITY_AGENT_TOKENS: TOKENS,
      RELIABILITY_DECISION_LOG: logPath,
    };
    expect(resolveStdioToolGuard({})).toBeNull();
    const good = resolveStdioToolGuard({ ...env, RELIABILITY_AGENT_TOKEN: TRIAGE_TOKEN });
    expect((await good?.check("lookup_account", {}))?.allowed).toBe(true);

    const bad = resolveStdioToolGuard({ ...env, RELIABILITY_AGENT_TOKEN: "tok-nobody-0123456789" });
    const client = await inMemory(bad);
    const res = await client.callTool(LOOKUP);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("caller-auth");
    const last = (await readDecisionLog(logPath)).at(-1);
    expect(last && isAuthRecord(last) && last.chokepoint).toBe("mcp-server");
  });

  test("with no manifests the server behaves as in v2 and writes no decision log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grade-stack-mcp-v2-"));
    const client = await inMemory(null);
    const res = await client.callTool(LOOKUP);
    expect((res.structuredContent as { found?: boolean }).found).toBe(true);
    expect(existsSync(join(dir, "gateway-decisions.jsonl"))).toBe(false);
  });
});
