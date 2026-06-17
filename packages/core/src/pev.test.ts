// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/pev.test
 *
 * Tests for the generic Planner/Executor/Validator loop: schema-enforced
 * validation (rejecting non-conforming output), fenced-JSON extraction, the
 * re-plan-on-failure loop, and the enforced turn bound.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type Executor,
  extractJsonObject,
  MaxTurnsError,
  type Planner,
  runPEV,
  zodValidator,
} from "./pev.ts";
import type { GenerateResult } from "./types.ts";

const Schema = z.object({
  category: z.enum(["a", "b"]),
  note: z.string().min(1),
});

/** A planner that just records prior issues; the plan is the text to echo. */
const echoPlanner: Planner<string[], { issue: string }> = {
  plan(_input, feedback) {
    return { issue: feedback.priorIssues[0] ?? "" };
  },
};

/** An executor that returns scripted model outputs, one per attempt. */
function scriptedExecutor(outputs: string[]): Executor<{ issue: string }> & { calls: number } {
  return {
    calls: 0,
    async execute(): Promise<GenerateResult> {
      const text = outputs[this.calls] ?? "";
      this.calls += 1;
      return {
        text,
        usage: { inputTokens: 5, outputTokens: 7 },
        provider: "stub",
        model: "test",
      };
    },
  };
}

describe("zodValidator", () => {
  test("rejects a schema-violating response with issues", () => {
    const v = zodValidator(Schema);
    const bad = v.validate(JSON.stringify({ category: "z", note: "" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.length).toBeGreaterThan(0);
      expect(bad.issues.join(" ")).toContain("category");
    }
  });

  test("accepts a conforming response and returns the typed value", () => {
    const v = zodValidator(Schema);
    const good = v.validate(JSON.stringify({ category: "a", note: "hi" }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.category).toBe("a");
  });

  test("rejects text with no JSON object", () => {
    const v = zodValidator(Schema);
    const r = v.validate("I cannot help with that.");
    expect(r.ok).toBe(false);
  });

  test("exposes a JSON Schema projection of the contract", () => {
    const v = zodValidator(Schema);
    expect(v.jsonSchema.type).toBe("object");
  });
});

describe("extractJsonObject", () => {
  test("strips a ```json fence (the Phase 1A Bedrock case)", () => {
    const fenced = '```json\n{"category":"a","note":"hi"}\n```';
    expect(extractJsonObject(fenced)).toEqual({ category: "a", note: "hi" });
  });

  test("falls back to the first { … } span amid prose", () => {
    const messy = 'Sure! Here you go:\n{"category":"b","note":"x"}\nHope that helps.';
    expect(extractJsonObject(messy)).toEqual({ category: "b", note: "x" });
  });

  test("returns undefined when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
  });
});

describe("runPEV", () => {
  test("converges in one turn on valid output", async () => {
    const exec = scriptedExecutor([JSON.stringify({ category: "a", note: "hi" })]);
    const r = await runPEV([], echoPlanner, exec, zodValidator(Schema), { maxTurns: 4 });
    expect(r.turns).toBe(1);
    expect(r.value.note).toBe("hi");
    expect(r.text).toBe('{"category":"a","note":"hi"}');
    // plan → execute → validate, all ok, one attempt.
    expect(r.steps.map((s) => s.phase)).toEqual(["plan", "execute", "validate"]);
    expect(r.steps.every((s) => s.status === "ok")).toBe(true);
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  test("re-plans on a validation failure, then converges", async () => {
    const exec = scriptedExecutor([
      "garbage, no json", // attempt 1 → rejected
      JSON.stringify({ category: "b", note: "fixed" }), // attempt 2 → ok
    ]);
    const r = await runPEV([], echoPlanner, exec, zodValidator(Schema), { maxTurns: 4 });
    expect(r.turns).toBe(2);
    expect(exec.calls).toBe(2);
    expect(r.value.note).toBe("fixed");
    // First validate fails, second succeeds; usage summed across both attempts.
    const validates = r.steps.filter((s) => s.phase === "validate");
    expect(validates.map((s) => s.status)).toEqual(["fail", "ok"]);
    expect(r.usage.inputTokens).toBe(10);
  });

  test("throws MaxTurnsError when output never conforms", async () => {
    const exec = scriptedExecutor(["nope", "still nope", "nope again", "nope"]);
    await expect(
      runPEV([], echoPlanner, exec, zodValidator(Schema), { maxTurns: 3 }),
    ).rejects.toBeInstanceOf(MaxTurnsError);
    expect(exec.calls).toBe(3); // bound enforced: exactly maxTurns model calls
  });

  test("a zero turn bound throws before any model call", async () => {
    const exec = scriptedExecutor([JSON.stringify({ category: "a", note: "hi" })]);
    await expect(
      runPEV([], echoPlanner, exec, zodValidator(Schema), { maxTurns: 0 }),
    ).rejects.toBeInstanceOf(MaxTurnsError);
    expect(exec.calls).toBe(0);
  });
});
