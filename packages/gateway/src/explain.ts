// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/explain
 *
 * Turns one decision-log record into one plain-language sentence a board member
 * can read (PLAN v3 explainability rule 2), for `reliability gateway log`. Pure:
 * no I/O, no clock. Every sentence names the request, the caller (or says there
 * was none), the time, what the gateway did, and the policy that fired.
 *
 * Phase 4C: a kill-switch control line reads as who halted or resumed the
 * gateway, when, and why; a request refused while halted says no model call
 * was made.
 *
 * Phase 4D: a review line reads as who held or decided which item, when, and
 * why; a held request says which item holds it. `describeReviewItem` and
 * `explainReviewItem` are the `reliability review list` and `show` readbacks.
 *
 * Phase 4E: an authenticated caller reads as `agent <id> (verified)`; a 401
 * reads as which chokepoint refused what and why; a tool line reads as which
 * agent called which tool and whether it ran. `describeAgent` and
 * `explainAgent` are the `reliability agents list` and `show` readbacks.
 */

import { ANONYMOUS_CALLER, AUTONOMY_LEVEL_LABEL, type LoadedManifest } from "./agent-manifest.ts";
import {
  type AuthRecord,
  type ControlRecord,
  type DecisionRecord,
  isAuthRecord,
  isControlRecord,
  isReviewRecord,
  isToolRecord,
  type RequestRecord,
  type ReviewRecord,
  type ToolRecord,
} from "./decision-log.ts";
import type { ReviewItem } from "./review-queue.ts";

/** `2026-10-28T10:14:03.512Z` → `2026-10-28 10:14:03 UTC`. */
function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function who(r: RequestRecord): string {
  if (r.callerId === null) return "an unidentified caller";
  if (r.callerId === ANONYMOUS_CALLER && !r.callerVerified) return "an anonymous caller";
  return r.callerVerified ? `agent ${r.callerId} (verified)` : `caller ${r.callerId} (unverified)`;
}

/** A 401 at either chokepoint: where, why, and what the request claimed. */
function auth(r: AuthRecord): string {
  const where = r.chokepoint === "gateway" ? "the gateway" : "the MCP server";
  const claimed =
    r.claimedCallerId === null ? "" : ` (claimed caller ${r.claimedCallerId}, not trusted)`;
  return `Request ${r.requestId} at ${when(r.at)} refused at ${where} with 401 by policy ${r.policy}: ${r.reason}${claimed}; nothing ran.`;
}

/** A tool call checked against the caller's manifest at the MCP server. */
function tool(r: ToolRecord): string {
  const level = r.autonomyLevel ? `, ${r.autonomyLevel}` : "";
  const caller = `${r.callerVerified ? "agent" : "caller"} ${r.callerId} (${r.callerVerified ? "verified" : "unverified"}${level})`;
  const did =
    r.action === "block"
      ? `${r.tool} refused at the MCP server by policy ${r.policy} (${r.reason}); the tool did not run`
      : `${r.tool} ran within the declared scope (${r.reason})`;
  return `Tool call ${r.requestId} from ${caller} at ${when(r.at)}: ${did}.`;
}

function servedBy(r: RequestRecord): string {
  const model = r.model ? ` (${r.model})` : "";
  const how = r.escalated ? " after escalation" : "";
  return `${r.servedBy ?? "the model"}${model}${how}`;
}

/** What the gateway did, as the clause after the colon. */
function what(r: RequestRecord): string {
  switch (r.action) {
    case "block":
      if (r.policy === "kill-switch") {
        return `refused by the kill switch (${r.reason}); no model call made`;
      }
      if (r.stage === "input" || r.servedBy === null) {
        return `input blocked by policy ${r.policy} (${r.reason}); no model call made`;
      }
      return `${servedBy(r)} answered, but the output was blocked by policy ${r.policy} (${r.reason}); nothing returned`;
    case "redact":
      return `answered by ${servedBy(r)}; ${r.redactions.join(", ")} redacted by policy ${r.policy} before return`;
    case "error":
      return `the model call failed (${r.reason}); nothing returned`;
    case "allow":
      if (r.policy === "confidence-router") {
        return `allowed and answered by ${servedBy(r)}; confidence router: ${r.reason}`;
      }
      return `allowed and answered by ${servedBy(r)}; it ${r.reason}`;
  }
}

/** A halt or resume, as who did it, when, and why. */
function control(r: ControlRecord): string {
  if (r.action === "halt") {
    return `Gateway halted by ${r.actor} at ${when(r.at)}: ${r.reason}. No requests served until resume.`;
  }
  return `Gateway resumed by ${r.actor} at ${when(r.at)}: ${r.reason}. Requests are served again.`;
}

/** A review event, as who held or decided which item, when, and why. */
function review(r: ReviewRecord): string {
  const caller = r.callerId === null ? "an unidentified caller" : `caller ${r.callerId}`;
  switch (r.event) {
    case "queued":
      return `Request ${r.requestId} from ${caller} held for human review at ${when(r.at)}: ${r.reason} (review ${r.reviewId}, trigger ${r.trigger}).`;
    case "approved":
      return `Review ${r.reviewId} for request ${r.requestId} approved by ${r.actor} at ${when(r.at)}: ${r.reason}.`;
    case "rejected":
      return `Review ${r.reviewId} for request ${r.requestId} rejected by ${r.actor} at ${when(r.at)}: ${r.reason}.`;
  }
}

/** One sentence for one record. */
export function describeDecision(r: DecisionRecord): string {
  if (isControlRecord(r)) return control(r);
  if (isReviewRecord(r)) return review(r);
  if (isAuthRecord(r)) return auth(r);
  if (isToolRecord(r)) return tool(r);
  const held = r.reviewId ? `; held for human review as ${r.reviewId}` : "";
  return `Request ${r.requestId} from ${who(r)} at ${when(r.at)}: ${what(r)}${held}.`;
}

/** One line per item for `reliability review list`. */
export function describeReviewItem(i: ReviewItem): string {
  const caller = i.callerId === null ? "an unidentified caller" : `caller ${i.callerId}`;
  const decided =
    i.resolution === null
      ? "pending"
      : `${i.resolution.event} by ${i.resolution.by} at ${when(i.resolution.at)}`;
  return `${i.id} [${decided}] ${i.trigger}: request ${i.requestId} from ${caller}, held ${when(i.queuedAt)}: ${i.reason}.`;
}

const TRIGGER_LABEL: Record<ReviewItem["trigger"], string> = {
  "low-confidence": "router confidence below the review threshold after frontier escalation",
  "max-turns": "the agent hit its turn bound without converging",
  "output-redaction": "the output guardrail redacted the answer",
  requested: "the request asked for a person to review it",
};

/** The `reliability review show` readback: why held, what, and who decided. */
export function explainReviewItem(i: ReviewItem): string[] {
  const caller = i.callerId === null ? "an unidentified caller" : `caller ${i.callerId}`;
  const lines = [
    `Review ${i.id}: ${i.status}.`,
    `Held at ${when(i.queuedAt)} for request ${i.requestId} from ${caller}.`,
    `Why held: ${i.reason}.`,
    `Trigger: ${i.trigger} (${TRIGGER_LABEL[i.trigger]}).`,
  ];
  const d = i.detail;
  if (d?.confidence !== undefined && d.threshold !== undefined) {
    lines.push(
      `Router: local agreement ${d.confidence.toFixed(2)}, review threshold ${d.threshold.toFixed(2)}, answered by ${d.servedBy ?? "the frontier"} after escalation.`,
    );
  }
  if (d?.redactions?.length) lines.push(`Redacted: ${[...new Set(d.redactions)].join(", ")}.`);
  if (d?.lastIssues?.length) lines.push(`Last validation issues: ${d.lastIssues.join("; ")}.`);
  lines.push(
    i.outputSha256 === null
      ? "Output: none (nothing was produced to release)."
      : `Output: sha256 ${i.outputSha256} (the decision log and any capture match on this hash).`,
  );
  const r = i.resolution;
  if (r === null) {
    lines.push(
      `Decision: pending. A named person decides: reliability review approve ${i.id} --as <name> [--note <text>], or reliability review reject ${i.id} --as <name> --reason <text>.`,
    );
  } else if (r.event === "approved") {
    lines.push(
      `Decision: approved by ${r.by} at ${when(r.at)}${r.note ? `: ${r.note}` : " (no note)"}.`,
    );
  } else {
    lines.push(`Decision: rejected by ${r.by} at ${when(r.at)}: ${r.reason}.`);
  }
  return lines;
}

const list = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "none");

/** One line per agent for `reliability agents list`. */
export function describeAgent({ manifest: m }: LoadedManifest): string {
  const review = m.reviewRequired
    ? "every response held for review"
    : "responses released without review";
  return `${m.id}: ${m.autonomyLevel} (${AUTONOMY_LEVEL_LABEL[m.autonomyLevel]}), owned by ${m.owner}; tools: ${list(m.allowedTools)}; models: ${list(m.allowedModels)}; ${m.maxTurns} turns per session, ${m.tokenCap} tokens per request; ${review}.`;
}

/** The `reliability agents show` readback: what the agent may do and how each limit is enforced. */
export function explainAgent({ manifest: m, file }: LoadedManifest): string[] {
  const lines = [
    `Agent ${m.id} (${file}).`,
    `Owner: ${m.owner}.`,
    `Autonomy: ${m.autonomyLevel}, ${AUTONOMY_LEVEL_LABEL[m.autonomyLevel]}.`,
  ];
  if (m.description) lines.push(`Purpose: ${m.description}`);
  lines.push(
    m.autonomyLevel === "L0"
      ? "Tools: none. It may only suggest; any tool call is refused with tool-not-allowed at the MCP server."
      : `Tools: ${list(m.allowedTools)}. Any other tool is refused with tool-not-allowed at the MCP server before it runs.`,
    `Models: ${list(m.allowedModels)}. Any other model is refused with agent-model-not-allowed at the gateway.`,
    `Turns: at most ${m.maxTurns} model calls per session; the next is refused with agent-turn-cap at the gateway.`,
    `Tokens: at most ${m.tokenCap} per request (never above the gateway-wide cap); more is refused with agent-token-cap.`,
    m.reviewRequired
      ? "Review: every response is held for a named person (reliability review list), whatever the request asks."
      : "Review: responses are released unless another review trigger holds them.",
    "Identity: the agent authenticates with its bearer token; requests without it get 401 at both chokepoints.",
  );
  return lines;
}
