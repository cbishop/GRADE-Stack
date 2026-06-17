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
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findAccountByEmail,
  findDuplicateCharges,
  searchHelpArticles,
  TRIAGE_POLICY,
} from "./data.ts";

/** Stable identity reported to clients on connect. */
export const SERVER_INFO = { name: "grade-stack-support", version: "0.1.0" } as const;

/** The URI of the triage-policy resource (the app-controlled reference data). */
export const TRIAGE_POLICY_URI = "policy://support/triage";

/**
 * Construct the support-desk MCP server with its one resource and two tools.
 * Pure and side-effect-free — the caller attaches a transport (`./connect`).
 */
export function createSupportMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO);

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
      inputSchema: { email: z.string().describe("The sender's email address.") },
    },
    ({ email }) => {
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
    },
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
      inputSchema: { query: z.string().describe("Free-text search query.") },
    },
    ({ query }) => {
      const articles = searchHelpArticles(query);
      return {
        content: [{ type: "text", text: JSON.stringify(articles) }],
        structuredContent: { articles },
      };
    },
  );

  return server;
}
