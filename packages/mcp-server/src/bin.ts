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
 * stdio note: the protocol owns stdout, so this file must never `console.log`
 * there; status goes to stderr.
 */

import { serveHttp, serveStdio } from "./connect.ts";

const args = process.argv.slice(2);

if (args.includes("--http")) {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? Number.parseInt(args[portFlag + 1] ?? "", 10) : 3333;
  const handle = serveHttp({ port: Number.isNaN(port) ? 3333 : port });
  process.stderr.write(`grade-stack support MCP server listening at ${handle.url}\n`);
} else {
  process.stderr.write("grade-stack support MCP server on stdio\n");
  await serveStdio();
}
