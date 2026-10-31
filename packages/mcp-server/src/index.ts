// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server
 *
 * Public surface of @grade-stack/mcp-server — the support-desk MCP server
 * (one app-controlled resource + two model-controlled tools), its transports
 * (stdio + streamable HTTP), the fixtures behind them, and (Phase 4E) the
 * per-agent tool guard that refuses undeclared tools before they run. The
 * reference agent launches it over stdio by re-running its own entry script
 * with `mcp serve` (Phase 4F), which works from source and from the bundled
 * CLI alike; `src/bin.ts` remains a standalone launcher for development.
 */

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
export {
  createSupportMcpServer,
  SERVER_INFO,
  SUPPORT_TOOL_INPUT_SCHEMAS,
  type SupportServerOptions,
  TRIAGE_POLICY_URI,
} from "./server.ts";
export {
  AGENT_TOKEN_ENV,
  resolveStdioToolGuard,
  type ToolDecision,
  ToolScopeGuard,
  type ToolScopeGuardOptions,
} from "./tool-scope.ts";
