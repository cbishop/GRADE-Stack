# @grade-stack/mcp-server

The GRADE-Stack support-desk **MCP server** (Phase 2B). It exposes one resource
and two tools, drawn so the **tool-vs-resource control model** is unambiguous,
and serves over both **stdio** (local) and **streamable HTTP** (remote).

## Tool vs. resource — the distinction that matters

MCP exposes two kinds of capability, and the line between them is a control
question, not a packaging one:

| | Controlled by | Is it an action? | Here |
|---|---|---|---|
| **Resource** | the **application** (host decides what to put in context) | no — it's data | `policy://support/triage` |
| **Tool** | the **model** (agent decides whether to call) | yes | `lookup_account`, `search_help_articles` |

**The mistake teams make:** shipping read-only reference data as a "tool" the
model has to call (now the model owns data the app should control), or hiding a
real action behind a "resource." We resolve it by control:

- **`policy://support/triage`** (resource) — the triage policy: priority rules,
  category routing, SLA targets. Stable, human-authored, **app-supplied**, no
  arguments. The application reads it and puts it in context. → resource.
- **`lookup_account`** (tool) — fetches the live account behind a sender's email
  (plan, SLA, open tickets, invoices, detected duplicate charges). The agent
  **decides** to call it when a decision depends on account state. → tool.
- **`search_help_articles`** (tool) — searches the help centre. A *second,
  plausible* tool, present so description-driven selection is observable.

## Descriptions drive selection (not names, not prompt rules)

Each tool's **description** is written to justify selection on its own — it
describes *what the tool returns*, never "call me for billing." The reference
agent selects tools **name-blind**: it shows the model each tool's description
and argument schema but **not its name**, so the choice can only follow the
description. See [ADR 0006](../../docs/decisions/0006-mcp-tool-resource-and-name-blind-selection.md).

```bash
# Watch a real model route two tasks from descriptions alone:
reliability mcp demo -p ollama
#   billing/refund question   → lookup_account
#   password-reset question   → search_help_articles
```

## Transports

The server logic is transport-agnostic; a transport is attached in `connect.ts`.

### stdio (local subprocess)

The default. The reference agent spawns the server as a child process and speaks
MCP over its stdin/stdout. The protocol owns stdout, so the server logs only to
stderr.

```bash
reliability mcp serve            # this process now speaks MCP on stdio
```

```ts
import { connectSupportTools } from "reference-agent"; // re-runs its entry script with `mcp serve`
const client = await connectSupportTools();
const tools = await client.listTools();
```

### streamable HTTP (remote)

For a server that runs elsewhere. Implemented over `Bun.serve` with the SDK's
Web-standard streamable-HTTP transport, **stateless** (a fresh server + transport
per request, so concurrent clients never share in-memory state).

```bash
reliability mcp serve --http --port 3333   # → http://localhost:3333/mcp
```

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "agent", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3333/mcp")));
```

Choose **stdio** when the server is a local, per-agent subprocess (lowest setup,
no network surface); choose **HTTP** when one server is shared across clients or
deployed remotely. The reference agent uses HTTP when `RELIABILITY_MCP_URL` is
set (`reliability agent run --mcp`), else spawns the server over stdio.

## Tool scope per agent (Phase 4E)

The gateway sees model calls, not tool calls, so the tool boundary is enforced
here, where tools run: the second chokepoint of
[ADR 0020](../../docs/decisions/0020-agent-manifest-bearer-tokens-two-chokepoints.md).
With `RELIABILITY_AGENTS_DIR` set, the server loads the same `agents/<id>.json`
manifests and tokens (`RELIABILITY_AGENT_TOKENS` or `RELIABILITY_AGENT_TOKENS_FILE`)
as the gateway, and:

- **over HTTP** every request needs `authorization: Bearer <token>`; a missing or
  unknown token is 401 with an `auth` line in the decision log;
- **over stdio** the agent passes its own token as `RELIABILITY_AGENT_TOKEN` to the
  process it spawns; a bad token refuses every tool call;
- every tool call is checked against the caller's manifest **before it runs**:
  an undeclared tool, or any tool from an L0 agent, returns an MCP tool error
  `tool-not-allowed: <reason>` and the tool's data is never read;
- every check, allowed or refused, writes one `tool` line to
  `RELIABILITY_DECISION_LOG` with the verified caller id, the tool and a hash of
  the arguments (never the arguments).

```bash
RELIABILITY_AGENTS_DIR=agents RELIABILITY_AGENT_TOKENS_FILE=.reliability-agent-tokens \
  reliability mcp serve --http --port 3333     # "tool scope: 1 agent manifest(s) ..."
reliability gateway log                        # "Tool call ... from agent helpdesk (verified, L0) ...: lookup_account refused at the MCP server by policy tool-not-allowed ..."
```

Over stdio the server is the agent's own child process and shares its trust
domain: a compromised agent could start an unguarded copy. Run it over HTTP,
with its own process and its own tokens file, for a real boundary. Without
`RELIABILITY_AGENTS_DIR` the server behaves as in v2 and logs nothing.

## Public API

- `createSupportMcpServer({ guard })` — build the `McpServer` (no transport
  attached); a `ToolScopeGuard` checks each tool call (Phase 4E).
- `serveStdio()` / `serveHttp({ port, path, agents, decisionLog })` — attach a transport.
- `ToolScopeGuard`, `resolveStdioToolGuard()` — the per-caller tool boundary.
- `TRIAGE_POLICY_URI`, plus the fixtures (`ACCOUNTS`, `HELP_ARTICLES`, …).
