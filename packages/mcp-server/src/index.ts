// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server
 *
 * Public surface of @grade-stack/mcp-server — the support-desk MCP server
 * (one app-controlled resource + two model-controlled tools), its transports
 * (stdio + streamable HTTP), and the fixtures behind them. The path to the
 * executable that launches it over stdio is exported as {@link SERVER_BIN} so
 * consumers (the reference agent) can spawn it without hard-coding a path.
 */

import { fileURLToPath } from "node:url";

export {
  type HttpServeOptions,
  type HttpServerHandle,
  serveHttp,
  serveStdio,
} from "./connect.ts";
export type { Account, HelpArticle, Invoice } from "./data.ts";
export {
  ACCOUNTS,
  findAccountByEmail,
  findDuplicateCharges,
  HELP_ARTICLES,
  searchHelpArticles,
  TRIAGE_POLICY,
} from "./data.ts";
export { createSupportMcpServer, SERVER_INFO, TRIAGE_POLICY_URI } from "./server.ts";

/** Absolute path to the stdio launcher — `bun <SERVER_BIN>` runs the server. */
export const SERVER_BIN = fileURLToPath(new URL("./bin.ts", import.meta.url));
