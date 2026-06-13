// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

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
