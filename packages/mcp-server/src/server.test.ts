// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/server.test
 *
 * In-memory client↔server tests for the support MCP server: the tool/resource
 * split is what the client actually sees, tools carry selection-driving
 * descriptions, and each tool returns the right facts. Uses the SDK's linked
 * in-memory transport so no process or socket is involved.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSupportMcpServer, TRIAGE_POLICY_URI } from "./server.ts";

async function connectedClient(): Promise<Client> {
  const server = createSupportMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("support MCP server", () => {
  let client: Client;
  beforeEach(async () => {
    client = await connectedClient();
  });

  test("exposes the policy as a resource, not a tool", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(TRIAGE_POLICY_URI);

    const { tools } = await client.listTools();
    // The control-model line: the policy is app-controlled data, so it must be a
    // resource and must NOT leak in as a model-invocable tool.
    expect(tools.map((t) => t.name)).not.toContain("triage-policy");
  });

  test("reading the policy resource returns the markdown", async () => {
    const { contents } = await client.readResource({ uri: TRIAGE_POLICY_URI });
    const first = contents[0];
    expect(first?.mimeType).toBe("text/markdown");
    expect(first && "text" in first ? String(first.text) : "").toContain("Support Triage Policy");
  });

  test("every tool ships a non-trivial description (descriptions drive selection)", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["lookup_account", "search_help_articles"]);
    for (const t of tools) {
      expect(t.description ?? "").not.toBe("");
      // A description that just restates the name can't drive selection.
      expect((t.description ?? "").length).toBeGreaterThan(t.name.length * 2);
    }
  });

  test("lookup_account surfaces the duplicate charge for a known sender", async () => {
    const res = await client.callTool({
      name: "lookup_account",
      arguments: { email: "dana@acme-retail.example" },
    });
    const data = (res.structuredContent ?? {}) as {
      found?: boolean;
      plan?: string;
      duplicateCharges?: { invoiceIds: string[]; amountUsd: number }[];
    };
    expect(data.found).toBe(true);
    expect(data.plan).toBe("growth");
    expect(data.duplicateCharges?.[0]?.invoiceIds).toEqual(["INV-20418", "INV-20419"]);
    expect(data.duplicateCharges?.[0]?.amountUsd).toBe(480);
  });

  test("lookup_account reports no account for an unknown sender", async () => {
    const res = await client.callTool({
      name: "lookup_account",
      arguments: { email: "nobody@unknown.example" },
    });
    expect((res.structuredContent as { found?: boolean })?.found).toBe(false);
  });

  test("search_help_articles finds the duplicate-charge article", async () => {
    const res = await client.callTool({
      name: "search_help_articles",
      arguments: { query: "refund a duplicate charge" },
    });
    const data = (res.structuredContent ?? {}) as { articles?: { id: string }[] };
    expect(data.articles?.[0]?.id).toBe("kb-billing-duplicate");
  });
});
