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
import type { AuthRecord, RequestRecord, ToolRecord } from "./decision-log.ts";
import { sha256Hex } from "./decision-log.ts";
import { describeAgent, describeDecision, explainAgent } from "./explain.ts";

function rec(over: Partial<RequestRecord> = {}): RequestRecord {
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

describe("Phase 4E sentences: authentication, tool scope and agents", () => {
  const tool = (over: Partial<ToolRecord> = {}): ToolRecord => ({
    v: 1,
    kind: "tool",
    at: "2026-10-29T09:00:00.000Z",
    requestId: "tc-1",
    callerId: "helpdesk",
    callerVerified: true,
    autonomyLevel: "L0",
    tool: "lookup_account",
    action: "block",
    policy: "tool-not-allowed",
    reason: "agent helpdesk is L0 (suggest only): it may not call tools",
    argsSha256: sha256Hex("{}"),
    ...over,
  });

  test("a refused tool call names the agent, the tool, the policy and that the tool did not run", () => {
    const line = describeDecision(tool());
    expect(line).toContain(
      "Tool call tc-1 from agent helpdesk (verified, L0) at 2026-10-29 09:00:00 UTC",
    );
    expect(line).toContain("lookup_account refused at the MCP server by policy tool-not-allowed");
    expect(line).toContain("the tool did not run");
  });

  test("an allowed tool call says it ran within the declared scope", () => {
    expect(
      describeDecision(
        tool({
          action: "allow",
          policy: "tool-scope",
          reason: "declared in agents/helpdesk.json",
          autonomyLevel: "L1",
        }),
      ),
    ).toContain("lookup_account ran");
  });

  test("a 401 names the chokepoint, the reason and any claimed caller, never a token", () => {
    const auth: AuthRecord = {
      v: 1,
      kind: "auth",
      at: "2026-10-29T09:00:00.000Z",
      requestId: "r-401",
      chokepoint: "gateway",
      endpoint: "/v1/generate",
      action: "refuse",
      status: 401,
      policy: "caller-auth",
      reason: "unknown bearer token",
      claimedCallerId: "triage",
    };
    const line = describeDecision(auth);
    expect(line).toBe(
      "Request r-401 at 2026-10-29 09:00:00 UTC refused at the gateway with 401 by policy caller-auth: unknown bearer token (claimed caller triage, not trusted); nothing ran.",
    );
  });

  test("a verified caller reads as an agent; an unverified one is marked", () => {
    expect(describeDecision(rec({ callerVerified: true }))).toContain(
      "from agent triage (verified)",
    );
    expect(describeDecision(rec())).toContain("from caller triage (unverified)");
  });

  test("agents list and show read in plain language", () => {
    const m = {
      id: "triage",
      owner: "support-lead@example.com",
      autonomyLevel: "L1" as const,
      allowedTools: ["lookup_account"],
      allowedModels: ["stub-deterministic"],
      maxTurns: 4,
      tokenCap: 800,
      reviewRequired: true,
    };
    expect(describeAgent({ manifest: m, file: "agents/triage.json" })).toBe(
      "triage: L1 (act with approval), owned by support-lead@example.com; tools: lookup_account; models: stub-deterministic; 4 turns per session, 800 tokens per request; every response held for review.",
    );
    const lines = explainAgent({ manifest: m, file: "agents/triage.json" }).join("\n");
    expect(lines).toContain("Agent triage (agents/triage.json)");
    expect(lines).toContain("Autonomy: L1, act with approval");
    expect(lines).toContain("refused with tool-not-allowed");
  });
});
