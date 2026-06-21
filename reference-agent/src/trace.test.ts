// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/trace.test
 *
 * Asserts the Phase 2D acceptance contract: a full agent run produces one
 * connected trace (plan → tool calls → validation). Uses a hermetic in-memory
 * tracer and deterministic fakes — no model, no MCP subprocess — so the
 * connected-trace property is enforced, not demonstrated by hand.
 */

import { describe, expect, test } from "bun:test";
import type { GenerateRequest, GenerateResult, ModelProvider } from "@grade-stack/core";
import { StubProvider, withInMemoryTracing } from "@grade-stack/core";
import { runReferenceAgent } from "./agent.ts";
import type { RemoteTool, SupportToolsClient } from "./mcp.ts";
import { SAMPLE_EMAIL } from "./sample-email.ts";

describe("agent run trace (Phase 2D)", () => {
  test("a plain run is one connected trace covering plan → execute → validate", async () => {
    const { result, spans, coverage } = await withInMemoryTracing(() =>
      runReferenceAgent(new StubProvider(), SAMPLE_EMAIL, {}),
    );
    expect(result.turns).toBeGreaterThanOrEqual(1);
    expect(coverage.connected).toBe(true);
    expect(coverage.observedPhases).toEqual(["plan", "execute", "validate"]);
    expect(coverage.modelCallSpans).toBeGreaterThanOrEqual(1);

    const root = spans.find((s) => s.name === "agent.run");
    expect(root?.parentSpanId).toBeUndefined();
    // The model call nests under the execute phase.
    const execute = spans.find((s) => s.name === "agent.execute");
    const chat = spans.find((s) => s.name.startsWith("chat "));
    expect(chat?.parentSpanId).toBe(execute?.spanId);
  });

  test("with MCP, the tool call is a span nested under grounding (plan → tool → validation)", async () => {
    const provider = selectionThenTriage();
    const { spans, coverage } = await withInMemoryTracing(() =>
      runReferenceAgent(provider, SAMPLE_EMAIL, { mcp: fakeClient() }),
    );
    expect(coverage.connected).toBe(true);
    expect(coverage.toolCallSpans).toBe(1);

    const ground = spans.find((s) => s.name === "mcp.ground");
    const tool = spans.find((s) => s.name.startsWith("execute_tool "));
    expect(ground).toBeDefined();
    expect(tool?.parentSpanId).toBe(ground?.spanId);
    // And the whole thing is still one trace under the single agent.run root.
    expect(coverage.rootSpans).toBe(1);
    expect(coverage.distinctTraces).toBe(1);
  });
});

const TOOLS: RemoteTool[] = [
  {
    name: "lookup_account",
    description: "Fetch the customer's billing and account state for a decision.",
    inputProperties: { email: { type: "string" } },
  },
];

/** A provider that picks tool option 1 for the selection prompt, else triages. */
function selectionThenTriage(): ModelProvider {
  const stub = new StubProvider();
  return {
    name: "stub",
    model: "fake",
    generate(req: GenerateRequest): Promise<GenerateResult> {
      const isSelection = (req.system ?? "").includes("You select which tool");
      if (isSelection) {
        return Promise.resolve({
          text: JSON.stringify({ choice: 1, arguments: { email: "dana@acme-retail.example" } }),
          usage: { inputTokens: 1, outputTokens: 1 },
          provider: "stub",
          model: "fake",
        });
      }
      return stub.generate(req);
    },
  };
}

function fakeClient(): SupportToolsClient {
  return {
    listTools: async () => TOOLS,
    readTriagePolicy: async () => "# Support Triage Policy\nbe kind",
    callTool: async () => ({ found: true, duplicateCharges: [{ invoiceIds: ["INV-1"] }] }),
    close: async () => {},
  };
}
