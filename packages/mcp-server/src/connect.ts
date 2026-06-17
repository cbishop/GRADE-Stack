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
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSupportMcpServer } from "./server.ts";

/**
 * Serve the support MCP server over **stdio** — the local-subprocess transport.
 * Resolves only when the transport closes, so callers can `await` the lifetime.
 */
export async function serveStdio(): Promise<void> {
  const server = createSupportMcpServer();
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
}

/** A running HTTP MCP server; call `stop()` to shut it down. */
export interface HttpServerHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/**
 * Serve the support MCP server over **streamable HTTP** (the remote transport),
 * stateless: a fresh server + transport per request, so concurrent clients never
 * share in-memory request state. Returns once it is listening.
 */
export function serveHttp(opts: HttpServeOptions = {}): HttpServerHandle {
  const path = opts.path ?? "/mcp";
  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return new Response("Not found", { status: 404 });
      }
      // Stateless: one server+transport per request (no cross-request state).
      const mcp = createSupportMcpServer();
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
    async stop() {
      await server.stop(true);
    },
  };
}
