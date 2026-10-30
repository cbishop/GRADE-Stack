// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/connect
 *
 * Attaches the support MCP server to a transport. Two are supported, matching
 * the two deployment shapes the PRD calls for: **stdio** for a local subprocess
 * (the reference agent spawns the server this way) and **streamable HTTP** for a
 * remote server (here over Bun.serve, in stateless mode). The server logic in
 * `./server` is transport-agnostic; this module owns only the wiring.
 *
 * Phase 4E (ADR 0020): with agent manifests (`RELIABILITY_AGENTS_DIR`, or an
 * injected registry) the HTTP server authenticates the bearer token on every
 * request (401 and an `auth` decision-log line otherwise) and builds the
 * per-request server with that agent's tool guard. Over stdio the token comes
 * from `RELIABILITY_AGENT_TOKEN` (see `./tool-scope`).
 */

import { randomUUID } from "node:crypto";
import {
  type AgentRegistry,
  resolveAgentRegistryFromEnv,
} from "@grade-stack/gateway/agent-manifest";
import { DecisionLog } from "@grade-stack/gateway/decision-log";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSupportMcpServer } from "./server.ts";
import { resolveStdioToolGuard, ToolScopeGuard } from "./tool-scope.ts";

/**
 * Serve the support MCP server over **stdio** — the local-subprocess transport.
 * Resolves only when the transport closes, so callers can `await` the lifetime.
 */
export async function serveStdio(): Promise<void> {
  const server = createSupportMcpServer({ guard: resolveStdioToolGuard() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Hold open until the transport closes (peer disconnects / process exits).
  await new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
}

export interface HttpServeOptions {
  port?: number;
  /** Path the MCP endpoint is mounted at. Defaults to `/mcp`. */
  path?: string;
  /**
   * The agents whose tool scope this server enforces (Phase 4E). Defaults to
   * the registry `RELIABILITY_AGENTS_DIR` configures; null forces none (v2).
   */
  agents?: AgentRegistry | null;
  /** Where tool and auth decisions are logged; defaults to `RELIABILITY_DECISION_LOG`. */
  decisionLog?: DecisionLog;
}

/** A running HTTP MCP server; call `stop()` to shut it down. */
export interface HttpServerHandle {
  url: string;
  port: number;
  /** The agents whose tool scope is enforced, or null without manifests (Phase 4E). */
  agents: AgentRegistry | null;
  /** The decision log tool and auth lines go to (Phase 4E). */
  decisionLogPath: string;
  stop(): Promise<void>;
}

/**
 * Serve the support MCP server over **streamable HTTP** (the remote transport),
 * stateless: a fresh server + transport per request, so concurrent clients never
 * share in-memory request state. Returns once it is listening.
 */
export function serveHttp(opts: HttpServeOptions = {}): HttpServerHandle {
  const path = opts.path ?? "/mcp";
  const agents = opts.agents === undefined ? resolveAgentRegistryFromEnv() : opts.agents;
  const log = opts.decisionLog ?? new DecisionLog();
  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return new Response("Not found", { status: 404 });
      }
      // 4E: authenticate the caller before anything reaches the MCP server.
      let guard: ToolScopeGuard | null = null;
      if (agents) {
        const caller = agents.authenticate(req.headers.get("authorization"));
        if (!caller.ok) {
          await log.append({
            v: 1,
            kind: "auth",
            at: new Date().toISOString(),
            requestId: randomUUID(),
            chokepoint: "mcp-server",
            endpoint: path,
            action: "refuse",
            status: 401,
            policy: "caller-auth",
            reason: caller.reason,
            claimedCallerId: null,
          });
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32001, message: `caller-auth: ${caller.reason}` },
              id: null,
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json",
                "www-authenticate": 'Bearer realm="grade-stack-mcp"',
              },
            },
          );
        }
        guard = new ToolScopeGuard({ caller, decisionLog: log, endpoint: `${path} tools/call` });
      }
      // Stateless: one server+transport per request (no cross-request state).
      const mcp = createSupportMcpServer({ guard });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcp.connect(transport);
      const res = await transport.handleRequest(req);
      // The per-request server/transport are torn down once the response stream
      // is handed back; closing here would cut off a streaming body.
      res.headers.set("x-mcp-server", "grade-stack-support");
      return res;
    },
  });
  const port = server.port ?? opts.port ?? 0;
  return {
    url: `http://localhost:${port}${path}`,
    port,
    agents,
    decisionLogPath: log.path,
    async stop() {
      await server.stop(true);
    },
  };
}
