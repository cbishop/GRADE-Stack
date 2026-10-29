#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/review-drill
 *
 * The human review drill (Phase 4D, ADR 0019). Produces the SAMPLE approval log
 * in `docs/human-oversight-map.md`: it starts a gateway over HTTP with the
 * confidence router and every review trigger on, backed by scripted stand-ins
 * for a local tier and a frontier tier (no model is called), and holds ten
 * items across the four triggers:
 *
 *   - 3 low-confidence: local votes split, the frontier answers, and local
 *     agreement is below `reviewBelow` 0.60;
 *   - 2 max-turns: the agent reports a `MaxTurnsError` over `POST /v1/review`;
 *   - 2 output-redaction: the answer carried an SSN or a card number;
 *   - 3 requested: the request set `requiresReview`.
 *
 * Then two named reviewers decide all ten with the operator's real verbs
 * (`reliability review approve|reject --as <name>`), and the drill checks the
 * refusals that make it oversight: a second approval, an automated approver and
 * the requesting caller are all refused. It writes the queue and the decision
 * log to `governance/drills/review-queue-<date>.jsonl` and
 * `review-decisions-<date>.jsonl`, prints the approval log as a Markdown table,
 * and exits 1 if any check fails.
 *
 *   bun scripts/review-drill.ts [--out <dir>] [--cli <built index.js>]
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  GatewayProvider,
  type GenerateRequest,
  type GenerateResult,
  MaxTurnsError,
  type ModelProvider,
  type ProviderName,
} from "../packages/core/src/index.ts";
import {
  DEFAULT_POLICY,
  DecisionLog,
  isReviewRecord,
  ReviewQueue,
  readDecisionLog,
  serveGateway,
} from "../packages/gateway/src/index.ts";
import { ConfidenceRouter } from "../packages/gateway/src/router.ts";

const repoRoot = join(import.meta.dir, "..");
const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(repoRoot, "governance", "drills") },
    cli: { type: "string" },
  },
});
const cli = ["bun", values.cli ?? join(repoRoot, "packages", "cli", "src", "index.ts")];

const TRIAGE_SYSTEM = "You are a customer-support triage assistant.";

/** A triage answer; `summary` can carry the PII the redaction trigger needs. */
function triage(category: string, summary = "A customer support request."): string {
  return JSON.stringify({
    category,
    priority: "high",
    sentiment: "negative",
    summary,
    draft_reply: "Thanks for getting in touch. We are looking into it and will reply today.",
  });
}

/**
 * Scripted stand-in for one tier. The local tier's votes are driven by a marker
 * in the email: `[split-40]` agrees 2 of 5, `[split-20]` 1 of 5, `[ssn]` and
 * `[card]` agree but echo PII; anything else agrees on billing.
 */
function scripted(name: ProviderName, model: string): ModelProvider {
  const votes = new Map<string, number>();
  return {
    name,
    model,
    generate(req: GenerateRequest): Promise<GenerateResult> {
      const text = req.messages.map((m) => m.content).join("\n");
      const n = votes.get(text) ?? 0;
      votes.set(text, n + 1);
      let out = triage("billing");
      if (name === "ollama" && text.includes("[split-40]")) {
        out = triage(["billing", "billing", "technical", "account", "other"][n % 5] ?? "other");
      } else if (name === "ollama" && text.includes("[split-20]")) {
        out =
          n % 5 === 4
            ? "not json"
            : triage(["billing", "technical", "account", "other"][n % 5] ?? "other");
      } else if (text.includes("[ssn]")) {
        out = triage("account", "Customer gave SSN 123-45-6789 to verify the account.");
      } else if (text.includes("[card]")) {
        out = triage("billing", "Charged twice on card 4111 1111 1111 1111.");
      }
      return Promise.resolve({
        text: out,
        usage: { inputTokens: Math.ceil(text.length / 4), outputTokens: Math.ceil(out.length / 4) },
        provider: name,
        model,
      });
    },
  };
}

const work = mkdtempSync(join(tmpdir(), "grade-stack-review-drill-"));
const queuePath = join(work, "review-queue.jsonl");
const logPath = join(work, "review-decisions.jsonl");
const log = new DecisionLog(logPath);
const local = scripted("ollama", "scripted-local-tier (drill stand-in)");
const frontier = scripted("bedrock", "scripted-frontier-tier (drill stand-in)");
const handle = serveGateway({
  decisionLog: log,
  reviewQueue: new ReviewQueue(queuePath, log),
  haltFile: join(work, ".reliability-halt"),
  policy: {
    ...DEFAULT_POLICY,
    review: { reviewBelow: 0.6, onMaxTurns: true, onRedaction: true, onRequest: true },
  },
  router: new ConfidenceRouter({
    local: "ollama",
    escalateTo: "bedrock",
    samples: 5,
    threshold: 0.5,
  }),
  resolveProvider: (t) => (t === "ollama" ? local : frontier),
});

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

/** Send one triage email through the gateway as caller `triage`; return the hold id. */
async function send(email: string, requiresReview = false): Promise<string | null> {
  const agent = new GatewayProvider({ url: handle.url, target: "ollama", callerId: "triage" });
  const r = await agent.generate({
    system: TRIAGE_SYSTEM,
    messages: [{ role: "user", content: email }],
    ...(requiresReview ? { requiresReview: true } : {}),
  });
  return r.review?.id ?? null;
}

/** Run the operator CLI against the drill's queue and log. */
function review(args: string[]) {
  const r = spawnSync(cli[0] as string, [...cli.slice(1), "review", ...args, "--file", queuePath], {
    env: { ...process.env, RELIABILITY_DECISION_LOG: logPath },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: r.stdout.trim(), err: r.stderr.trim() };
}

const held: string[] = [];
try {
  // One request the gateway serves and releases: confident local, nothing to hold.
  check((await send("Hi, when does my plan renew?")) === null, "a confident answer was held");

  for (const email of [
    "[split-40] My invoice and my login both look wrong since the migration.",
    "[split-20] Something is off with the account, the bill and the app, not sure which.",
    "[split-40] Is the outage why I was charged a late fee?",
  ]) {
    held.push((await send(email)) ?? "");
  }
  const agent = new GatewayProvider({ url: handle.url, target: "ollama", callerId: "triage" });
  for (const issues of [
    ["category: invalid enum value 'refund'"],
    ["draft_reply: required", "priority: invalid enum value 'p1'"],
  ]) {
    const res = await agent.requestReview(new MaxTurnsError(3, issues));
    held.push(res.held ? res.id : "");
  }
  held.push((await send("[ssn] Please update my address, my SSN is on file.")) ?? "");
  held.push((await send("[card] You charged my card twice for the same order.")) ?? "");
  for (const email of [
    "Please cancel my contract and refund the last three months.",
    "I want to dispute the termination fee on my account.",
    "Your agent promised me a credit last week; where is it?",
  ]) {
    held.push((await send(email, true)) ?? "");
  }
} finally {
  await handle.stop();
}
check(held.length === 10 && held.every((id) => id.startsWith("rv-")), "ten items held");

// Ten dated decisions by two named reviewers, through the operator's verbs.
const decisions: [number, "approve" | "reject", string, string][] = [
  [0, "approve", "support-lead", "frontier answer matches the invoice history"],
  [1, "reject", "support-lead", "ambiguous request; asked the customer which issue comes first"],
  [2, "approve", "support-lead", "late fee is real; draft explains the waiver process"],
  [3, "reject", "risk-officer", "agent could not classify; handled manually"],
  [4, "reject", "risk-officer", "no usable draft after three turns; routed to tier 2"],
  [5, "approve", "risk-officer", "SSN redacted before return; draft is safe to send"],
  [6, "approve", "support-lead", "card number redacted; duplicate charge confirmed"],
  [7, "approve", "risk-officer", "cancellation terms quoted correctly"],
  [8, "approve", "risk-officer", "fee dispute acknowledged without admitting liability"],
  [9, "approve", "support-lead", "credit confirmed in billing before sending"],
];
for (const [i, action, by, text] of decisions) {
  const id = held[i] ?? "";
  if (i === 0) {
    // The refusals that make it oversight, tried on the first item before its decision.
    check(
      review(["approve", id, "--as", "gateway"]).code === 1,
      "an automated approver was accepted",
    );
    check(
      review(["approve", id, "--as", "triage"]).code === 1,
      "the requesting caller approved itself",
    );
  }
  const r =
    action === "approve"
      ? review(["approve", id, "--as", by, "--note", text])
      : review(["reject", id, "--as", by, "--reason", text]);
  check(r.code === 0, `${action} ${id} failed: ${r.err}`);
}
check(
  review(["approve", held[0] ?? "", "--as", "support-lead"]).code === 1,
  "a second approval was accepted",
);

const items = await new ReviewQueue(queuePath).items();
const lines = (await readDecisionLog(logPath)).filter(isReviewRecord);
check(
  items.length === 10 && items.every((i) => i.resolution?.by && i.resolution.at),
  "every item decided by name and time",
);
check(
  lines.filter((l) => l.event === "queued").length === 10,
  "ten queued lines in the decision log",
);
check(
  lines.filter((l) => l.event !== "queued").length === 10,
  "ten decision lines in the decision log",
);

const date = new Date().toISOString().slice(0, 10);
mkdirSync(values.out, { recursive: true });
const queueOut = join(values.out, `review-queue-${date}.jsonl`);
const logOut = join(values.out, `review-decisions-${date}.jsonl`);
copyFileSync(queuePath, queueOut);
copyFileSync(logPath, logOut);

const hhmm = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
console.log(`Review drill ${date}: ${failures.length === 0 ? "PASSED" : "FAILED"}`);
console.log(`  held: ${items.length} items; decided: ${items.filter((i) => i.resolution).length}`);
console.log(`  refused: automated approver, requesting caller, second approval`);
console.log(`  queue:        ${queueOut}`);
console.log(`  decision log: ${logOut}\n`);
console.log("| # | Item | Trigger | Held | Why held | Decision | By | At | Note or reason |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [n, i] of items.entries()) {
  const r = i.resolution;
  const note = r ? (r.event === "rejected" ? r.reason : (r.note ?? "")) : "";
  console.log(
    `| ${n + 1} | \`${i.id}\` | ${i.trigger} | ${hhmm(i.queuedAt)} | ${i.reason} | ${i.status} | ${r?.by ?? ""} | ${r ? hhmm(r.at) : ""} | ${note} |`,
  );
}
if (failures.length > 0) {
  console.error(`\nFailed checks:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
