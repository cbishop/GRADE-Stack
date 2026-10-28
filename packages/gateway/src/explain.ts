// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/explain
 *
 * Turns one decision-log record into one plain-language sentence a board member
 * can read (PLAN v3 explainability rule 2), for `reliability gateway log`. Pure:
 * no I/O, no clock. Every sentence names the request, the caller (or says there
 * was none), the time, what the gateway did, and the policy that fired.
 */

import type { DecisionRecord } from "./decision-log.ts";

/** `2026-10-28T10:14:03.512Z` → `2026-10-28 10:14:03 UTC`. */
function when(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function who(r: DecisionRecord): string {
  if (r.callerId === null) return "an unidentified caller";
  return `caller ${r.callerId}${r.callerVerified ? "" : " (unverified)"}`;
}

function servedBy(r: DecisionRecord): string {
  const model = r.model ? ` (${r.model})` : "";
  const how = r.escalated ? " after escalation" : "";
  return `${r.servedBy ?? "the model"}${model}${how}`;
}

/** What the gateway did, as the clause after the colon. */
function what(r: DecisionRecord): string {
  switch (r.action) {
    case "block":
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

/** One sentence for one record. */
export function describeDecision(r: DecisionRecord): string {
  return `Request ${r.requestId} from ${who(r)} at ${when(r.at)}: ${what(r)}.`;
}
