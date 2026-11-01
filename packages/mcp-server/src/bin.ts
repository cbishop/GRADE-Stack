#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/bin
 *
 * Executable entry point for the support MCP server. Defaults to **stdio** (the
 * transport the reference agent spawns); pass `--http [--port N]` to serve over
 * **streamable HTTP** instead. Kept thin — all logic lives in `./connect`.
 *
 * HTTP flags: `--port N` (default 3333), `--host NAME` (default
 * `RELIABILITY_MCP_HOST`, else `127.0.0.1`; a non-loopback host needs agent
 * manifests, or the server refuses to start and this exits 1).
 *
 * stdio note: the protocol owns stdout, so this file must never `console.log`
 * there; status goes to stderr.
 */

import { serveHttp, serveStdio } from "./connect.ts";

const args = process.argv.slice(2);

if (args.includes("--http")) {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? Number.parseInt(args[portFlag + 1] ?? "", 10) : 3333;
  const hostFlag = args.indexOf("--host");
  const hostname = hostFlag !== -1 ? args[hostFlag + 1] : undefined;
  let handle: ReturnType<typeof serveHttp>;
  try {
    handle = serveHttp({
      port: Number.isNaN(port) ? 3333 : port,
      ...(hostname ? { hostname } : {}),
    });
  } catch (err) {
    // A refused bind (finding 7) or a broken manifest (4E): say why, no stack.
    process.stderr.write(
      `MCP server not started: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`grade-stack support MCP server listening at ${handle.url}\n`);
} else {
  process.stderr.write("grade-stack support MCP server on stdio\n");
  await serveStdio();
}
