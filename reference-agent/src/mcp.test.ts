// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/mcp.test
 *
 * Tests the consume-the-MCP-server mechanism: the selection prompt is
 * **name-blind** (so a tool's name cannot drive selection), and when only the
 * descriptions are swapped between two tools the model's choice follows the
 * description — the Phase 2B property. Uses deterministic fake providers/clients
 * so no model or subprocess is involved.
 */

import { describe, expect, test } from "bun:test";
import type { GenerateRequest, GenerateResult, ModelProvider } from "@grade-stack/core";
import {
  buildSelectionPrompt,
  type Grounding,
  groundTriage,
  parseSelection,
  type RemoteTool,
  type SupportToolsClient,
  selectTool,
} from "./mcp.ts";

const ACCOUNT_DESC = "Fetch the customer's billing and account state for a decision.";
const HELP_DESC = "Search help-centre documentation for step-by-step guidance.";

function tools(accountDesc: string, helpDesc: string): RemoteTool[] {
  return [
    {
      name: "lookup_account",
      description: accountDesc,
      inputProperties: { email: { type: "string" } },
    },
    {
      name: "search_help_articles",
      description: helpDesc,
      inputProperties: { query: { type: "string" } },
    },
  ];
}

/** A provider that selects the numbered option whose description contains `needle`. */
function pickByDescription(needle: string): ModelProvider {
  return {
    name: "stub",
    model: "fake",
    generate(req: GenerateRequest): Promise<GenerateResult> {
      const user = req.messages[0]?.content ?? "";
      const lines = user.split("\n");
      let choice: number | null = null;
      for (const line of lines) {
        const m = /^\[(\d+)\]\s*(.*)$/.exec(line);
        if (m?.[2]?.includes(needle)) choice = Number.parseInt(m[1] ?? "", 10);
      }
      return Promise.resolve({
        text: JSON.stringify({ choice, arguments: { email: "x@y.example" } }),
        usage: { inputTokens: 0, outputTokens: 0 },
        provider: "stub",
        model: "fake",
      });
    },
  };
}

describe("name-blind tool selection", () => {
  test("the selection prompt carries descriptions but never tool names", () => {
    const { system, user } = buildSelectionPrompt(tools(ACCOUNT_DESC, HELP_DESC), "a task");
    const prompt = `${system}\n${user}`;
    expect(prompt).toContain(ACCOUNT_DESC);
    expect(prompt).toContain(HELP_DESC);
    // The mechanism: a model literally cannot route by name because the name is
    // never in its input.
    expect(prompt).not.toContain("lookup_account");
    expect(prompt).not.toContain("search_help_articles");
  });

  test("selection follows the description, not the name (swap test)", async () => {
    const provider = pickByDescription("billing and account state");

    // Names in fixed positions; the account-state description sits on lookup_account.
    const a = await selectTool(provider, tools(ACCOUNT_DESC, HELP_DESC), "billing problem");
    expect(a?.tool).toBe("lookup_account");

    // Swap ONLY the descriptions. The account-state description now sits on
    // search_help_articles — and selection moves with it.
    const b = await selectTool(provider, tools(HELP_DESC, ACCOUNT_DESC), "billing problem");
    expect(b?.tool).toBe("search_help_articles");
  });

  test("parseSelection rejects null, out-of-range, and garbage choices", () => {
    const t = tools(ACCOUNT_DESC, HELP_DESC);
    expect(parseSelection('{"choice": null}', t)).toBeNull();
    expect(parseSelection('{"choice": 9}', t)).toBeNull();
    expect(parseSelection("not json", t)).toBeNull();
    expect(parseSelection('{"choice": 1, "arguments": {"email":"a@b"}}', t)?.tool).toBe(
      "lookup_account",
    );
  });
});

describe("groundTriage", () => {
  function fakeClient(): SupportToolsClient {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    return {
      listTools: async () => tools(ACCOUNT_DESC, HELP_DESC),
      readTriagePolicy: async () => "# Support Triage Policy\nbe kind",
      callTool: async (name, args) => {
        calls.push({ name, args });
        return {
          found: true,
          duplicateCharges: [{ invoiceIds: ["INV-1", "INV-2"], amountUsd: 480 }],
        };
      },
      close: async () => {},
      // expose calls for assertions
      _calls: calls,
    } as SupportToolsClient & { _calls: typeof calls };
  }

  test("reads the policy resource and folds the selected tool's facts into context", async () => {
    const client = fakeClient();
    const grounding: Grounding = await groundTriage(
      pickByDescription("billing and account state"),
      client,
      "From: dana@acme-retail.example\nbilling problem",
    );
    expect(grounding.policy).toContain("Support Triage Policy");
    expect(grounding.selection?.tool).toBe("lookup_account");
    expect(grounding.context).toContain("Triage policy (reference data)");
    expect(grounding.context).toContain("INV-1");
  });
});
