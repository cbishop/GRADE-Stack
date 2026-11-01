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
 *
 * Security finding 7 (ADR 0020, "Bind address"): the HTTP server binds
 * `127.0.0.1` unless the `hostname` option or `RELIABILITY_MCP_HOST` says
 * otherwise, and the returned `url` names the address it actually bound. A
 * non-loopback bind with no agent manifests throws before anything listens.
 * The transport's DNS-rebinding protection is on: a request whose `Host` is not
 * a name this server answers to, or whose `Origin` is a page other than its
 * own, is refused with 403 before the MCP server sees it.
 */

import { randomUUID } from "node:crypto";
import { isLoopbackHost } from "@grade-stack/core";
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

/** Overrides the bind address when the `hostname` option is not given. */
export const MCP_HOST_ENV = "RELIABILITY_MCP_HOST";

/** The bind address when neither the option nor the env names one. */
export const DEFAULT_MCP_HOST = "127.0.0.1";

/** The largest request body the HTTP server reads (1 MiB). */
export const MCP_MAX_REQUEST_BODY_BYTES = 1_048_576;

export interface HttpServeOptions {
  port?: number;
  /**
   * Address to bind (security finding 7). Defaults to `RELIABILITY_MCP_HOST`,
   * else `127.0.0.1`. A non-loopback address needs an agent registry with at
   * least one agent, or the server refuses to start.
   */
  hostname?: string;
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
 * Refuse a bind that would expose an anonymous MCP server (finding 7). Loopback
 * is always allowed; anything else needs at least one agent manifest, so every
 * request from the network must carry a bearer token (ADR 0020).
 */
function assertSafeBind(hostname: string, agents: AgentRegistry | null): void {
  if (isLoopbackHost(hostname)) return;
  if (agents && agents.manifests.length > 0) return;
  throw new Error(
    `Refusing to bind the MCP server to "${hostname}" with no agent manifests: anyone who can reach that address could call every tool anonymously. ` +
      `Either bind loopback (omit --host / ${MCP_HOST_ENV}, or use ${DEFAULT_MCP_HOST}), ` +
      "or configure agents (RELIABILITY_AGENTS_DIR plus RELIABILITY_AGENT_TOKENS) so every request needs a bearer token.",
  );
}

/** A host as it appears in a URL or `Host` header; IPv6 literals go in brackets. */
function urlHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

/** A wildcard bind answers on every interface, under names it cannot know. */
function isWildcardHost(hostname: string): boolean {
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

/**
 * The `Host` and `Origin` values this server answers to (finding 7). A
 * DNS-rebinding page reaches a loopback server under the attacker's name, so
 * the transport refuses any `Host` not listed (the SDK compares the whole
 * header, port included) and any `Origin` not listed (a request with no
 * `Origin`, as from a non-browser client, passes). The loopback names are
 * always listed; a specific non-loopback bind adds its own name. A wildcard
 * bind is reached under names it cannot list, so it skips the `Host` check and
 * relies on the bearer token every request then needs (`assertSafeBind`).
 */
function rebindingAllowList(
  hostname: string,
  port: number,
): { allowedHosts?: string[]; allowedOrigins: string[] } {
  const names = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!isWildcardHost(hostname)) names.add(urlHost(hostname));
  const hosts = [...names].map((n) => `${n}:${port}`);
  const allowedOrigins = hosts.map((h) => `http://${h}`);
  return isWildcardHost(hostname) ? { allowedOrigins } : { allowedHosts: hosts, allowedOrigins };
}

/**
 * Serve the support MCP server over **streamable HTTP** (the remote transport),
 * stateless: a fresh server + transport per request, so concurrent clients never
 * share in-memory request state. Returns once it is listening.
 */
export function serveHttp(opts: HttpServeOptions = {}): HttpServerHandle {
  const path = opts.path ?? "/mcp";
  const agents = opts.agents === undefined ? resolveAgentRegistryFromEnv() : opts.agents;
  // Finding 7: loopback unless told otherwise, and never public and anonymous.
  // Checked before the log or the socket exists, so a refusal leaves nothing behind.
  const hostname = opts.hostname ?? (process.env[MCP_HOST_ENV] || DEFAULT_MCP_HOST);
  assertSafeBind(hostname, agents);
  const log = opts.decisionLog ?? new DecisionLog();
  // Filled in once the socket exists and the real port is known.
  let rebinding: ReturnType<typeof rebindingAllowList> = { allowedHosts: [], allowedOrigins: [] };
  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname,
    maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
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
        // Finding 7: refuse a foreign Host or Origin (403) before any MCP message is read.
        enableDnsRebindingProtection: true,
        ...rebinding,
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
  rebinding = rebindingAllowList(hostname, port);
  return {
    url: `http://${urlHost(hostname)}:${port}${path}`,
    port,
    agents,
    decisionLogPath: log.path,
    async stop() {
      await server.stop(true);
    },
  };
}
