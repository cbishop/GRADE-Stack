#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/bin
 *
 * Executable entry point for the standalone gateway server. Run directly or via
 * `reliability gateway serve`. This is the process that holds provider
 * credentials; the agent process must not. Kept thin — all logic lives in
 * `./connect` and `./gateway`.
 *
 * Flags: `--port N` (default 8787).
 */

import { serveGateway } from "./connect.ts";
import { resolveRouterFromEnv } from "./router.ts";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag !== -1 ? Number.parseInt(args[portFlag + 1] ?? "", 10) : 8787;

const handle = serveGateway({ port: Number.isNaN(port) ? 8787 : port });
process.stderr.write(
  `grade-stack gateway listening at ${handle.url} — set RELIABILITY_GATEWAY_URL=${handle.url} in the agent process\n`,
);

// Surface the confidence-router operating point when routing is enabled, so the
// running config is visible in the logs rather than buried in the environment.
const router = resolveRouterFromEnv();
if (router) {
  const c = router.config;
  process.stderr.write(
    `confidence router ON — ${c.local} ×${c.samples}@t${c.temperature}, escalate to ${c.escalateTo} ` +
      `below agreement ${c.threshold} on [${c.consensusFields.join(", ") || "full-text"}]\n`,
  );
}
