// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/agent.test
 *
 * Tests for the reference agent — the enforced turn bound and the degraded-mode
 * regression — run hermetically against a canned provider.
 */

import { describe, expect, test } from "bun:test";
import type { GenerateRequest, GenerateResult, ModelProvider } from "@grade-stack/core";
import { MaxTurnsError, runReferenceAgent } from "./agent.ts";
import { SAMPLE_EMAIL } from "./sample-email.ts";

/** A canned provider returning a complete triage JSON, so tests are hermetic. */
class FakeProvider implements ModelProvider {
  readonly name = "stub" as const;
  readonly model = "fake";
  calls = 0;
  async generate(_request: GenerateRequest): Promise<GenerateResult> {
    this.calls += 1;
    return {
      text: JSON.stringify({
        category: "billing",
        priority: "high",
        sentiment: "negative",
        summary: "A billing issue.",
        draft_reply: "We'll look into your billing issue.",
      }),
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: this.name,
      model: this.model,
    };
  }
}

/** Returns triage JSON fenced in a ```json block, as Claude on Bedrock does. */
class FencedProvider implements ModelProvider {
  readonly name = "bedrock" as const;
  readonly model = "fake-fenced";
  async generate(_request: GenerateRequest): Promise<GenerateResult> {
    const json = JSON.stringify({
      category: "technical",
      priority: "high",
      sentiment: "neutral",
      summary: "A technical issue.",
      draft_reply: "We'll investigate.",
    });
    return {
      text: `Here is the triage:\n\`\`\`json\n${json}\n\`\`\``,
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: this.name,
      model: this.model,
    };
  }
}

/** Returns an unparseable answer first, then valid JSON — forces a re-plan. */
class FlakyProvider implements ModelProvider {
  readonly name = "ollama" as const;
  readonly model = "fake-flaky";
  calls = 0;
  lastUserPrompt = "";
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.calls += 1;
    this.lastUserPrompt = request.messages.map((m) => m.content).join("\n");
    const text =
      this.calls === 1
        ? "I'm not sure how to format this."
        : JSON.stringify({
            category: "account",
            priority: "medium",
            sentiment: "neutral",
            summary: "An account issue.",
            draft_reply: "We'll help with your account.",
          });
    return {
      text,
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: this.name,
      model: this.model,
    };
  }
}

describe("runReferenceAgent — structured output (Phase 2A)", () => {
  test("extracts and validates fenced JSON (the 1A Bedrock fix)", async () => {
    const result = await runReferenceAgent(new FencedProvider(), SAMPLE_EMAIL);
    expect(result.turns).toBe(1);
    // raw is the canonical (un-fenced) serialization of the validated triage.
    expect(result.raw.startsWith("{")).toBe(true);
    expect(result.triage.category).toBe("technical");
  });

  test("re-plans on a rejected response and feeds issues back to the planner", async () => {
    const p = new FlakyProvider();
    const result = await runReferenceAgent(p, SAMPLE_EMAIL, { maxTurns: 4 });
    expect(result.turns).toBe(2);
    expect(p.calls).toBe(2);
    expect(result.triage.category).toBe("account");
    // The re-plan handed the validator's complaint back to the model.
    expect(p.lastUserPrompt).toContain("rejected by the schema validator");
  });

  test("exposes a plan/execute/validate trace", async () => {
    const result = await runReferenceAgent(new FakeProvider(), SAMPLE_EMAIL);
    expect(result.steps.map((s) => s.phase)).toEqual(["plan", "execute", "validate"]);
  });
});

describe("runReferenceAgent — turn bound", () => {
  test("a normal run takes exactly one turn and reports it", async () => {
    const p = new FakeProvider();
    const result = await runReferenceAgent(p, SAMPLE_EMAIL, { maxTurns: 4 });
    expect(result.turns).toBe(1);
    expect(p.calls).toBe(1);
  });

  test("a zero turn bound is enforced: it throws before any model call", async () => {
    const p = new FakeProvider();
    await expect(runReferenceAgent(p, SAMPLE_EMAIL, { maxTurns: 0 })).rejects.toBeInstanceOf(
      MaxTurnsError,
    );
    expect(p.calls).toBe(0);
  });
});

describe("runReferenceAgent — degraded mode", () => {
  test("degraded output drops required fields (a real regression)", async () => {
    const p = new FakeProvider();
    const result = await runReferenceAgent(p, SAMPLE_EMAIL, { degraded: true });
    expect(result.degraded).toBe(true);
    const o = JSON.parse(result.raw);
    expect(o.draft_reply).toBeUndefined();
    expect(o.summary).toBeUndefined();
  });

  test("normal mode preserves the full contract", async () => {
    const p = new FakeProvider();
    const result = await runReferenceAgent(p, SAMPLE_EMAIL, { degraded: false });
    expect(result.degraded).toBe(false);
    const o = JSON.parse(result.raw);
    expect(typeof o.draft_reply).toBe("string");
    expect(typeof o.summary).toBe("string");
  });
});
