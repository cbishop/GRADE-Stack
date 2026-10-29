// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/server
 *
 * Builds the support-desk MCP server and is where this package takes its one
 * opinionated stand: the **tool-vs-resource control model**. A *resource*
 * (`policy://support/triage`) is application-controlled data the host chooses to
 * put in context; *tools* (`lookup_account`, `search_help_articles`) are
 * model-controlled actions the agent decides to invoke. Tool **descriptions**
 * (not names, not prompt rules) are written to be the sole basis a model needs
 * to choose between them — `search_help_articles` is deliberately present as a
 * second, plausible option so description-driven selection is observable.
 *
 * Phase 4E (ADR 0020): given a {@link ToolScopeGuard}, every tool call is
 * checked against the caller's manifest before its handler runs; a refused call
 * returns an MCP tool error (`isError`) naming the policy, and the tool's data
 * is never read. Without a guard the server behaves as in v2.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  findAccountByEmail,
  findDuplicateCharges,
  searchHelpArticles,
  TRIAGE_POLICY,
} from "./data.ts";
import type { ToolScopeGuard } from "./tool-scope.ts";

/** Stable identity reported to clients on connect. */
export const SERVER_INFO = { name: "grade-stack-support", version: "0.1.0" } as const;

/** The URI of the triage-policy resource (the app-controlled reference data). */
export const TRIAGE_POLICY_URI = "policy://support/triage";

/**
 * The argument schema of each tool, exported so a release manifest (Phase 4C)
 * can hash exactly what the server registers: a changed argument shows up as
 * "tool `x` arguments changed" in `reliability release diff`.
 */
export const SUPPORT_TOOL_INPUT_SCHEMAS = {
  lookup_account: { email: z.string().describe("The sender's email address.") },
  search_help_articles: { query: z.string().describe("Free-text search query.") },
} as const;

export interface SupportServerOptions {
  /**
   * The caller's tool boundary (Phase 4E). When set, each tool call is checked
   * and logged before it runs; null or absent means no manifests (v2).
   */
  guard?: ToolScopeGuard | null;
}

/**
 * Run a tool handler only if the guard allows it. A refusal is an MCP tool
 * error whose text starts with the policy, so a client can tell
 * `tool-not-allowed` from a tool that failed.
 */
function scoped<A>(
  guard: ToolScopeGuard | null | undefined,
  tool: string,
  handler: (args: A) => CallToolResult,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    if (guard) {
      const decision = await guard.check(tool, args);
      if (!decision.allowed) {
        return {
          isError: true,
          content: [{ type: "text", text: `${decision.policy}: ${decision.reason}` }],
        };
      }
    }
    return handler(args);
  };
}

/**
 * Construct the support-desk MCP server with its one resource and two tools.
 * Pure and side-effect-free — the caller attaches a transport (`./connect`).
 */
export function createSupportMcpServer(opts: SupportServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);
  const guard = opts.guard;

  // ── Resource: application-controlled reference data ───────────────────────
  // The triage policy is stable guidance the *application* decides to surface.
  // It is not an action and takes no arguments — modelling it as a resource (not
  // a tool) is the defensible half of the control-model distinction.
  server.registerResource(
    "triage-policy",
    TRIAGE_POLICY_URI,
    {
      title: "Support triage policy",
      description:
        "The support team's triage policy: priority rules, category routing, " +
        "and first-response SLA targets by plan. Reference data the application " +
        "supplies to ground a triage — not an action.",
      mimeType: "text/markdown",
    },
    () => ({
      contents: [{ uri: TRIAGE_POLICY_URI, mimeType: "text/markdown", text: TRIAGE_POLICY }],
    }),
  );

  // ── Tool: a model-controlled action that fetches live account facts ───────
  // The description is written to fully justify selection on its own. It never
  // says "call me for billing" — it describes *what data it returns*, and the
  // model infers fit. lookupAccount is the right tool when the agent needs the
  // sender's billing/account state (e.g. to confirm a duplicate charge).
  server.registerTool(
    "lookup_account",
    {
      title: "Look up account",
      description:
        "Retrieve the customer account behind a sender's email address: their " +
        "company, plan and first-response SLA, open-ticket count, recent " +
        "invoices, and any detected duplicate charges. Use when a decision " +
        "depends on the customer's actual billing or account state.",
      inputSchema: SUPPORT_TOOL_INPUT_SCHEMAS.lookup_account,
    },
    scoped(guard, "lookup_account", ({ email }: { email: string }): CallToolResult => {
      const account = findAccountByEmail(email);
      if (!account) {
        return {
          content: [{ type: "text", text: `No account found for "${email}".` }],
          structuredContent: { found: false },
        };
      }
      const duplicates = findDuplicateCharges(account);
      const structured = {
        found: true,
        company: account.company,
        plan: account.plan,
        responseSlaHours: account.responseSlaHours,
        openTickets: account.openTickets,
        invoices: account.invoices,
        duplicateCharges: duplicates.map((group) => ({
          invoiceIds: group.map((i) => i.id),
          amountUsd: group[0]?.amountUsd ?? 0,
          date: group[0]?.date ?? "",
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    }),
  );

  // ── Tool: the distractor that makes selection observable ──────────────────
  // A second, genuinely useful tool. If tool *names* or hard-coded prompt rules
  // were driving selection, this would be ignored; because descriptions drive
  // selection, the agent picks this one for a how-to question and lookup_account
  // for an account-state question.
  server.registerTool(
    "search_help_articles",
    {
      title: "Search help articles",
      description:
        "Search the public help centre for articles matching a query and return " +
        "their titles and links. Use when the customer needs step-by-step " +
        "guidance or documentation, not when a decision depends on their " +
        "specific account state.",
      inputSchema: SUPPORT_TOOL_INPUT_SCHEMAS.search_help_articles,
    },
    scoped(guard, "search_help_articles", ({ query }: { query: string }): CallToolResult => {
      const articles = searchHelpArticles(query);
      return {
        content: [{ type: "text", text: JSON.stringify(articles) }],
        structuredContent: { articles },
      };
    }),
  );

  return server;
}
