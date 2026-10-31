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
 *
 * Phase 4E (ADR 0020): the agent presents its bearer token
 * (`RELIABILITY_AGENT_TOKEN`) to the MCP server too. Over HTTP
 * (`RELIABILITY_MCP_URL`) it is an `authorization` header on every request;
 * over stdio it is passed to the spawned server's environment with the manifest
 * settings. A tool the server refuses (`tool-not-allowed`, `caller-auth`)
 * surfaces as a {@link ToolRefusedError}; grounding records it and continues
 * without the tool's facts.
 */

import {
  extractJsonObject,
  GENAI,
  type ModelProvider,
  SpanKind,
  withSpan,
} from "@grade-stack/core";
import { TRIAGE_POLICY_URI } from "@grade-stack/mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Env naming a remote (HTTP) MCP server; unset means spawn it over stdio. */
export const MCP_URL_ENV = "RELIABILITY_MCP_URL";

/**
 * Settings the spawned stdio server needs to enforce tool scope (4E). The MCP
 * SDK passes only a minimal default environment to a child, so these are
 * forwarded explicitly; provider credentials never are.
 */
const STDIO_FORWARDED_ENV = [
  "RELIABILITY_AGENT_TOKEN",
  "RELIABILITY_AGENTS_DIR",
  "RELIABILITY_AGENT_TOKENS",
  "RELIABILITY_AGENT_TOKENS_FILE",
  "RELIABILITY_DECISION_LOG",
] as const;

/** Policies the MCP server refuses a tool call with (Phase 4E). */
const REFUSAL_POLICIES = ["tool-not-allowed", "caller-auth"] as const;

/** The MCP server refused a tool call before it ran (Phase 4E). */
export class ToolRefusedError extends Error {
  override name = "ToolRefusedError";
  constructor(
    readonly tool: string,
    readonly policy: string,
    readonly reason: string,
  ) {
    super(`MCP server refused ${tool}: ${policy}: ${reason}`);
  }
}

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
 * The command that launches the stdio MCP server: the running entry script
 * itself, with `mcp serve` (Phase 4F). The `reliability` CLI answers `mcp
 * serve` from source and from the bundled `dist/index.js` alike, and so does
 * the eval bridge, the entry under the eval harness. A path resolved from
 * `import.meta.url` (the old `SERVER_BIN`) pointed at a `bin.ts` that does not
 * exist once the CLI is bundled.
 */
export function stdioServerCommand(): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (!entry) throw new Error("cannot spawn the stdio MCP server: no entry script to re-run");
  return { command: process.execPath, args: [entry, "mcp", "serve"] };
}

/**
 * Connect to the support MCP server over **stdio**, spawning it as a subprocess
 * ({@link stdioServerCommand}), or over HTTP when `RELIABILITY_MCP_URL` is set.
 * stdio is the local transport; the same server also serves over HTTP for a
 * remote deployment (see the package README).
 */
export async function connectSupportTools(): Promise<SupportToolsClient> {
  const token = process.env.RELIABILITY_AGENT_TOKEN;
  const url = process.env[MCP_URL_ENV];
  const transport =
    url && url.length > 0
      ? new StreamableHTTPClientTransport(new URL(url), {
          requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
        })
      : new StdioClientTransport({
          ...stdioServerCommand(),
          env: {
            ...getDefaultEnvironment(),
            ...Object.fromEntries(
              STDIO_FORWARDED_ENV.flatMap((k) => {
                const v = process.env[k];
                return v ? [[k, v]] : [];
              }),
            ),
          },
        });
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
      // 4E: a scope refusal is an error result whose text starts with the policy.
      if (res.isError) {
        const policy = REFUSAL_POLICIES.find((p) => text.startsWith(`${p}: `));
        if (policy) throw new ToolRefusedError(name, policy, text.slice(policy.length + 2));
      }
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
  /** The selected tool's result, if a tool was called and allowed. */
  toolResult: unknown;
  /** The selected tool the MCP server refused (Phase 4E), if any. */
  refused?: { tool: string; policy: string; reason: string };
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
    let refused: Grounding["refused"];
    const parts = ["## Triage policy (reference data)", policy];
    if (selection) {
      try {
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
      } catch (err) {
        // The boundary held (4E): ground without the tool rather than fail the run.
        if (!(err instanceof ToolRefusedError)) throw err;
        refused = { tool: err.tool, policy: err.policy, reason: err.reason };
      }
    }
    return {
      policy,
      selection,
      toolResult,
      ...(refused ? { refused } : {}),
      context: parts.join("\n"),
    };
  });
}
