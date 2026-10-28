// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/explain.test
 *
 * Tests the plain-language readback (Phase 4B): each decision path becomes one
 * sentence naming the request, the caller (or its absence), the time, what the
 * gateway did and the policy that fired.
 */

import { describe, expect, test } from "bun:test";
import type { DecisionRecord } from "./decision-log.ts";
import { sha256Hex } from "./decision-log.ts";
import { describeDecision } from "./explain.ts";

function rec(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    v: 1,
    at: "2026-10-28T10:14:03.512Z",
    requestId: "7f3a",
    callerId: "triage",
    callerVerified: false,
    target: "bedrock",
    action: "allow",
    stage: null,
    policy: "guardrails",
    reason: "passed every input and output guardrail",
    redactions: [],
    servedBy: "bedrock",
    model: "claude",
    escalated: false,
    confidence: null,
    inputSha256: sha256Hex("i"),
    outputSha256: sha256Hex("o"),
    tokens: { input: 1, output: 1 },
    latencyMs: 1,
    contentCaptured: false,
    ...over,
  };
}

describe("describeDecision", () => {
  test("input block: names the policy and says no model call was made", () => {
    expect(
      describeDecision(
        rec({
          action: "block",
          stage: "input",
          policy: "prompt-injection",
          reason: "request contains an instruction-override / jailbreak attempt",
          servedBy: null,
          model: null,
          outputSha256: null,
        }),
      ),
    ).toBe(
      "Request 7f3a from caller triage (unverified) at 2026-10-28 10:14:03 UTC: input blocked by policy prompt-injection (request contains an instruction-override / jailbreak attempt); no model call made.",
    );
  });

  test("redaction: names what was redacted and the policy", () => {
    const s = describeDecision(
      rec({ action: "redact", stage: "output", policy: "pii-redaction", redactions: ["SSN"] }),
    );
    expect(s).toContain("answered by bedrock (claude); SSN redacted by policy pii-redaction");
  });

  test("escalation: says the frontier answered after escalation, and why", () => {
    const s = describeDecision(
      rec({
        policy: "confidence-router",
        reason: "local agreement 0% was below the 50% threshold; escalated to bedrock",
        escalated: true,
        confidence: 0,
      }),
    );
    expect(s).toContain("after escalation");
    expect(s).toContain("below the 50% threshold");
  });

  test("output block, upstream error and a missing caller each read plainly", () => {
    expect(
      describeDecision(
        rec({ action: "block", stage: "output", policy: "secret-exfiltration", reason: "x" }),
      ),
    ).toContain("the output was blocked by policy secret-exfiltration");
    expect(
      describeDecision(rec({ action: "error", reason: "provider call failed: down" })),
    ).toContain("the model call failed");
    expect(describeDecision(rec({ callerId: null }))).toContain("from an unidentified caller");
    expect(describeDecision(rec({ callerVerified: true }))).toContain("from caller triage at");
  });
});
