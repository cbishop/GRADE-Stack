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
 */

import {
  type ControlRecord,
  type DecisionRecord,
  isControlRecord,
  isReviewRecord,
  type RequestRecord,
  type ReviewRecord,
} from "./decision-log.ts";
import type { ReviewItem } from "./review-queue.ts";

/** `2026-10-28T10:14:03.512Z` → `2026-10-28 10:14:03 UTC`. */
function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function who(r: RequestRecord): string {
  if (r.callerId === null) return "an unidentified caller";
  return `caller ${r.callerId}${r.callerVerified ? "" : " (unverified)"}`;
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
