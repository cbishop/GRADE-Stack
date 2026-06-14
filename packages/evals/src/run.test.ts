// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/run.test
 *
 * Tests for folding promptfoo output — phase-trace construction and the
 * collapse of repeated runs into a per-case stability score.
 */

import { describe, expect, test } from "bun:test";
import { buildTrace, foldCase, type PromptfooComponent, type PromptfooRow } from "./run.ts";

function component(metric: string, pass: boolean): PromptfooComponent {
  return { metric, pass, score: pass ? 1 : 0, assertion: { metric } } as PromptfooComponent;
}

function row(opts: {
  success: boolean;
  components: PromptfooComponent[];
  promptTokens?: number;
  completionTokens?: number;
}): PromptfooRow {
  return {
    success: opts.success,
    score: opts.success ? 1 : 0,
    testCase: { description: "case" },
    response: { output: "{}" },
    tokenUsage: { prompt: opts.promptTokens ?? 0, completion: opts.completionTokens ?? 0 },
    gradingResult: { componentResults: opts.components },
  };
}

describe("buildTrace", () => {
  test("always emits all three phases in order, with plan skipped when no plan checks exist", () => {
    const trace = buildTrace([
      component("execute:responded", true),
      component("validate:json-valid", true),
    ]);
    expect(trace.map((s) => s.phase)).toEqual(["plan", "execute", "validate"]);
    expect(trace[0]?.status).toBe("skipped"); // no planner in the naive agent yet
    expect(trace[1]?.status).toBe("ok");
    expect(trace[2]?.status).toBe("ok");
  });

  test("a phase is 'fail' if any of its checks fail", () => {
    const trace = buildTrace([
      component("execute:responded", true),
      component("validate:json-valid", true),
      component("validate:fields", false),
    ]);
    expect(trace[2]?.status).toBe("fail");
  });

  test("unprefixed metrics default to the validator phase", () => {
    const trace = buildTrace([component("is-json", false)]);
    expect(trace[2]?.checks.map((c) => c.metric)).toContain("is-json");
    expect(trace[2]?.status).toBe("fail");
  });
});

describe("foldCase", () => {
  test("a single passing repeat yields pass with perfect stability", () => {
    const result = foldCase("case", [
      row({ success: true, components: [component("validate:json-valid", true)] }),
    ]);
    expect(result.pass).toBe(true);
    expect(result.stability).toBe(1);
    expect(result.repeats).toBe(1);
  });

  test("majority outcome wins and stability is the agreeing fraction", () => {
    // 2 of 3 repeats pass -> majority pass, stability 2/3.
    const result = foldCase("case", [
      row({ success: true, components: [] }),
      row({ success: true, components: [] }),
      row({ success: false, components: [] }),
    ]);
    expect(result.pass).toBe(true);
    expect(result.stability).toBeCloseTo(2 / 3, 5);
  });

  test("a tie counts as passing and token usage is summed across repeats", () => {
    const result = foldCase("case", [
      row({ success: true, components: [], promptTokens: 10, completionTokens: 5 }),
      row({ success: false, components: [], promptTokens: 20, completionTokens: 7 }),
    ]);
    expect(result.pass).toBe(true); // tie -> majority rule treats as pass
    expect(result.stability).toBe(0.5);
    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.outputTokens).toBe(12);
  });
});
