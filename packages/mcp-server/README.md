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
import { connectSupportTools } from "reference-agent"; // spawns bun <SERVER_BIN>
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
deployed remotely (then put the gateway / auth in front of it — Phase 2C).

## Public API

- `createSupportMcpServer()` — build the `McpServer` (no transport attached).
- `serveStdio()` / `serveHttp({ port, path })` — attach a transport.
- `SERVER_BIN` — absolute path to the stdio launcher (`bun <SERVER_BIN>`).
- `TRIAGE_POLICY_URI`, plus the fixtures (`ACCOUNTS`, `HELP_ARTICLES`, …).
