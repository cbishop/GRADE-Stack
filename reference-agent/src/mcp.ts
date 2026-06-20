// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/mcp
 *
 * How the reference agent **consumes** the MCP server (Phase 2B). It owns three
 * things and no model policy: (1) a thin stdio client wrapper that spawns the
 * `@grade-stack/mcp-server` subprocess; (2) the app-controlled step of reading
 * the triage-policy **resource** into context; and (3) **name-blind tool
 * selection** — the agent is shown each tool's description and argument schema
 * but never its name, so selection provably follows the description, never the
 * name or a hard-coded `if billing → lookup_account` rule. The model call goes
 * through the {@link ModelProvider} text seam, so no provider-native tool-use is
 * introduced (keeps the 2C gateway / 3D air-gap seam narrow — see ADR 0006).
 */

import {
  extractJsonObject,
  GENAI,
  type ModelProvider,
  SpanKind,
  withSpan,
} from "@grade-stack/core";
import { SERVER_BIN, TRIAGE_POLICY_URI } from "@grade-stack/mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** A tool as the client sees it: a name to call by and a description to choose by. */
export interface RemoteTool {
  name: string;
  description: string;
  /** JSON-Schema properties of the tool's input, used to render the arg hints. */
  inputProperties: Record<string, { type?: string; description?: string }>;
}

/** The agent's view of the MCP server: discover, read data, take actions, close. */
export interface SupportToolsClient {
  listTools(): Promise<RemoteTool[]>;
  readTriagePolicy(): Promise<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Connect to the support MCP server over **stdio**, spawning it as a subprocess
 * (`bun <SERVER_BIN>`). This is the local transport; the same server also serves
 * over HTTP for a remote deployment (see the package README).
 */
export async function connectSupportTools(): Promise<SupportToolsClient> {
  const transport = new StdioClientTransport({ command: "bun", args: [SERVER_BIN] });
  const client = new Client({ name: "reference-agent", version: "0.1.0" });
  await client.connect(transport);

  return {
    async listTools(): Promise<RemoteTool[]> {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputProperties:
          (t.inputSchema?.properties as RemoteTool["inputProperties"] | undefined) ?? {},
      }));
    },
    async readTriagePolicy(): Promise<string> {
      const { contents } = await client.readResource({ uri: TRIAGE_POLICY_URI });
      return contents.map((c) => ("text" in c ? String(c.text ?? "") : "")).join("\n");
    },
    async callTool(name, args): Promise<unknown> {
      const res = await client.callTool({ name, arguments: args });
      // Prefer the machine-readable payload; fall back to the text content.
      if (res.structuredContent !== undefined) return res.structuredContent;
      const text = Array.isArray(res.content)
        ? res.content.map((c) => (c.type === "text" ? c.text : "")).join("")
        : "";
      return text;
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

/** A tool choice resolved back to the concrete tool name and its arguments. */
export interface ToolSelection {
  tool: string;
  arguments: Record<string, unknown>;
}

function renderArgHints(tool: RemoteTool): string {
  const entries = Object.entries(tool.inputProperties);
  if (entries.length === 0) return "(no arguments)";
  return entries
    .map(([k, v]) => `${k}: ${v.type ?? "string"}${v.description ? ` — ${v.description}` : ""}`)
    .join(", ");
}

/**
 * Build the **name-blind** selection prompt: each tool is a numbered option
 * carrying only its description and argument hints — never its name. A model can
 * therefore choose only on what the tools *do*, which is the property Phase 2B
 * requires. Exported so a test can assert no tool name leaks into the prompt.
 */
export function buildSelectionPrompt(
  tools: RemoteTool[],
  task: string,
): { system: string; user: string } {
  const system = [
    "You select which tool, if any, best helps accomplish a task.",
    "You are given numbered options; each option lists what the tool does and the",
    "arguments it accepts — you are NOT told the tools' names. Decide only from",
    "those descriptions and argument schemas.",
    'Respond with one JSON object and nothing else: {"choice": <option number or null>,',
    '"arguments": { ... }}. Use null when no option fits. Fill arguments from the task.',
  ].join("\n");

  const options = tools
    .map((t, i) => `[${i + 1}] ${t.description}\n     arguments — ${renderArgHints(t)}`)
    .join("\n");

  const user = [`Task:\n${task}`, "", "Options:", options, "", "Respond with JSON only."].join(
    "\n",
  );
  return { system, user };
}

/**
 * Parse a name-blind selection back to a concrete tool. Reuses core's tolerant
 * JSON extraction (real models fence/pad JSON). Returns `null` for "no tool" or
 * an out-of-range / unparseable choice — the caller then grounds without a tool.
 */
export function parseSelection(raw: string, tools: RemoteTool[]): ToolSelection | null {
  const obj = extractJsonObject(raw) as { choice?: unknown; arguments?: unknown } | undefined;
  if (!obj || obj.choice === null || obj.choice === undefined) return null;
  const idx = typeof obj.choice === "number" ? obj.choice : Number.parseInt(String(obj.choice), 10);
  if (!Number.isInteger(idx) || idx < 1 || idx > tools.length) return null;
  const tool = tools[idx - 1];
  if (!tool) return null;
  const args =
    obj.arguments && typeof obj.arguments === "object"
      ? (obj.arguments as Record<string, unknown>)
      : {};
  return { tool: tool.name, arguments: args };
}

/**
 * Ask the model to pick a tool for the task from descriptions alone, then resolve
 * the choice to a concrete tool name. One bounded model call through the provider
 * seam; returns `null` when the model selects no tool.
 */
export async function selectTool(
  provider: ModelProvider,
  tools: RemoteTool[],
  task: string,
): Promise<ToolSelection | null> {
  const { system, user } = buildSelectionPrompt(tools, task);
  const out = await provider.generate({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 200,
    temperature: 0,
  });
  return parseSelection(out.text, tools);
}

/** What the MCP grounding step produced, for the agent's trace and result. */
export interface Grounding {
  /** The app-controlled triage policy read from the resource. */
  policy: string;
  /** The tool the model chose (by description), if any, and its arguments. */
  selection: ToolSelection | null;
  /** The selected tool's result, if a tool was called. */
  toolResult: unknown;
  /** The context block to fold into the planner's system prompt. */
  context: string;
}

/**
 * Ground a triage from MCP: read the policy **resource** (app-controlled), let
 * the model **select a tool** from descriptions, call it, and assemble a context
 * block. This is the consume-the-MCP-server step the reference agent runs before
 * planning; the result feeds the planner as extra context, never replacing the
 * schema contract the validator still enforces.
 */
export async function groundTriage(
  provider: ModelProvider,
  client: SupportToolsClient,
  task: string,
): Promise<Grounding> {
  // One span for the whole grounding step; the tool-selection model call nests a
  // GenAI `chat` span under it, and the chosen tool call nests an `execute_tool`
  // span — so MCP shows up in the connected trace (Phase 2D).
  return withSpan("mcp.ground", { kind: SpanKind.INTERNAL }, async () => {
    const policy = await client.readTriagePolicy();
    const tools = await client.listTools();
    const selection = await selectTool(provider, tools, task);

    let toolResult: unknown;
    const parts = ["## Triage policy (reference data)", policy];
    if (selection) {
      toolResult = await withSpan(
        `execute_tool ${selection.tool}`,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            [GENAI.operationName]: "execute_tool",
            [GENAI.toolName]: selection.tool,
          },
        },
        () => client.callTool(selection.tool, selection.arguments),
      );
      parts.push(
        "",
        `## Account/help lookup (tool: ${selection.tool})`,
        "Use these facts; do not invent account details:",
        JSON.stringify(toolResult),
      );
    }
    return { policy, selection, toolResult, context: parts.join("\n") };
  });
}
