// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/data
 *
 * The support desk's backing data — a small, in-memory stand-in for the systems
 * a real deployment would query (billing, CRM, a help-centre index). It owns the
 * fixtures only; the control-model decision about *how* each shape is exposed
 * (model-controlled tool vs. app-controlled resource) lives in `./server`. Kept
 * deterministic so the in-memory transport test and any demo are reproducible.
 */

/** A billing line item on an account. */
export interface Invoice {
  id: string;
  /** ISO date the invoice was raised. */
  date: string;
  amountUsd: number;
  status: "paid" | "open" | "refunded";
}

/** A customer account, keyed by the email domain of the people who write in. */
export interface Account {
  /** Email domain that maps inbound senders to this account. */
  domain: string;
  company: string;
  plan: "starter" | "growth" | "enterprise";
  /** Contractual first-response target, in hours, for this plan. */
  responseSlaHours: number;
  openTickets: number;
  invoices: Invoice[];
}

/** A help-centre article the support team can point customers to. */
export interface HelpArticle {
  id: string;
  title: string;
  /** Lowercase keywords used for the deterministic fixture search. */
  keywords: string[];
  url: string;
}

/**
 * The fixture accounts. Dana (acme-retail.example) is the sender of the default
 * sample email and carries the duplicate June charge the triage agent should
 * surface — two identical `open` invoices on the same day.
 */
export const ACCOUNTS: readonly Account[] = [
  {
    domain: "acme-retail.example",
    company: "Acme Retail",
    plan: "growth",
    responseSlaHours: 8,
    openTickets: 2,
    invoices: [
      { id: "INV-20418", date: "2026-06-01", amountUsd: 480, status: "open" },
      { id: "INV-20419", date: "2026-06-01", amountUsd: 480, status: "open" },
      { id: "INV-20102", date: "2026-05-01", amountUsd: 480, status: "paid" },
    ],
  },
  {
    domain: "globex.example",
    company: "Globex",
    plan: "enterprise",
    responseSlaHours: 4,
    openTickets: 0,
    invoices: [{ id: "INV-30771", date: "2026-06-03", amountUsd: 2400, status: "paid" }],
  },
] as const;

/** The help-centre index backing the `search_help_articles` tool. */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: "kb-billing-duplicate",
    title: "Resolving a duplicate charge",
    keywords: ["duplicate", "charge", "refund", "billing", "invoice"],
    url: "https://help.example/billing/duplicate-charge",
  },
  {
    id: "kb-reset-password",
    title: "Resetting your password",
    keywords: ["password", "login", "reset", "account", "access"],
    url: "https://help.example/account/reset-password",
  },
  {
    id: "kb-api-timeouts",
    title: "Diagnosing API timeouts",
    keywords: ["api", "timeout", "error", "technical", "integration"],
    url: "https://help.example/technical/api-timeouts",
  },
] as const;

/** Look up an account from a sender's email address by its domain. */
export function findAccountByEmail(email: string): Account | undefined {
  const at = email.lastIndexOf("@");
  if (at === -1) return undefined;
  const domain = email.slice(at + 1).toLowerCase();
  return ACCOUNTS.find((a) => a.domain === domain);
}

/** Two `open` invoices with the same amount and date are a likely duplicate. */
export function findDuplicateCharges(account: Account): Invoice[][] {
  const groups = new Map<string, Invoice[]>();
  for (const inv of account.invoices) {
    if (inv.status !== "open") continue;
    const key = `${inv.date}:${inv.amountUsd}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(inv);
    groups.set(key, bucket);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Deterministic keyword search over the help-centre index. */
export function searchHelpArticles(query: string, limit = 3): HelpArticle[] {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  const scored = HELP_ARTICLES.map((article) => {
    const score = article.keywords.reduce(
      (n, kw) => n + (terms.includes(kw) ? 1 : 0),
      // A title-word match also counts, so plain-language queries still land.
      terms.reduce((n, t) => n + (article.title.toLowerCase().includes(t) ? 1 : 0), 0),
    );
    return { article, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.article);
}

/**
 * The support triage policy — the app-controlled reference data exposed as an
 * MCP **resource** (`policy://support/triage`). It is stable, human-authored
 * guidance the application chooses to put in front of the model, not an action
 * the model decides to take. That is exactly the tool-vs-resource line.
 */
export const TRIAGE_POLICY = `# Support Triage Policy

## Priority
- **urgent** — money is moving the wrong way (duplicate/incorrect charge,
  failed payout) OR a customer-stated deadline is within 2 business days.
- **high** — a paying customer is blocked and no workaround exists.
- **medium** — degraded experience with a workaround.
- **low** — questions, feedback, feature requests.

## Routing by category
- **billing** → Finance queue. Always check the account for duplicate or
  incorrect charges before replying.
- **technical** → Support Engineering. Link the relevant help-centre article.
- **account** → Identity/Access queue.
- **other** → General queue.

## First-response SLA (by plan)
- enterprise: 4 hours · growth: 8 hours · starter: 24 hours.

## Tone
- Acknowledge the customer's stated frustration explicitly.
- Never promise a refund as final; say it has been escalated/initiated.
`;
