// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/report.test
 *
 * Tests for the per-case interaction report renderers — that the Markdown table
 * has one row per case, that a failing case's failed check and its judge reason
 * surface in the detail, that the agent output is included, and that the HTML is
 * a self-contained, escaped page.
 */

import { describe, expect, test } from "bun:test";
import { computeCost } from "./pricing.ts";
import { renderRunHtml, renderRunMarkdown } from "./report.ts";
import type { CaseResult, EvalRunResult } from "./types.ts";

function passingCase(id: string): CaseResult {
  return {
    id,
    description: `desc ${id}`,
    pass: true,
    score: 1,
    trace: [
      { phase: "plan", status: "skipped", checks: [] },
      {
        phase: "execute",
        status: "ok",
        checks: [{ metric: "execute:answered", pass: true, score: 1 }],
      },
      {
        phase: "validate",
        status: "ok",
        checks: [{ metric: "validate:json-valid", pass: true, score: 1, reason: "parsed cleanly" }],
      },
    ],
    output: '{"category":"billing"}',
    usage: { inputTokens: 120, outputTokens: 40 },
    stability: 1,
    repeats: 1,
  };
}

function failingCase(id: string): CaseResult {
  return {
    id,
    description: `desc ${id} | with a pipe`,
    pass: false,
    score: 0.5,
    trace: [
      { phase: "plan", status: "skipped", checks: [] },
      {
        phase: "execute",
        status: "ok",
        checks: [{ metric: "execute:answered", pass: true, score: 1 }],
      },
      {
        phase: "validate",
        status: "fail",
        checks: [
          {
            metric: "validate:judge",
            pass: false,
            score: 0,
            reason: "the draft over-promises a full refund",
          },
        ],
      },
    ],
    output: "I'll refund everything right away.",
    usage: { inputTokens: 130, outputTokens: 55 },
    stability: 1,
    repeats: 1,
  };
}

function makeRun(): EvalRunResult {
  const cases = [passingCase("billing-double-charge"), failingCase("refund-overpromise")];
  const usage = {
    inputTokens: cases.reduce((s, c) => s + c.usage.inputTokens, 0),
    outputTokens: cases.reduce((s, c) => s + c.usage.outputTokens, 0),
  };
  return {
    provider: "ollama",
    model: "gemma4:12b-mlx",
    judgeProvider: "ollama",
    timestamp: "2026-06-26T00:00:00.000Z",
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      meanStability: 1,
      usage,
      cost: computeCost("ollama", "gemma4:12b-mlx", usage, 1),
    },
    cases,
  };
}

describe("renderRunMarkdown", () => {
  const md = renderRunMarkdown(makeRun());

  test("has one table row per case with its pass/fail mark", () => {
    expect(md).toContain("| 1 | billing-double-charge | ✅ PASS |");
    expect(md).toContain("| 2 | refund-overpromise | ❌ FAIL |");
  });

  test("surfaces a failing check's metric and the judge reason", () => {
    expect(md).toContain("`validate:judge`");
    expect(md).toContain("the draft over-promises a full refund");
  });

  test("includes the agent output and the run/cost header", () => {
    expect(md).toContain("I'll refund everything right away.");
    expect(md).toContain("1/2 passed (50%)");
    expect(md).toContain("cost-per-success");
  });

  test("escapes pipes so the table is not broken by case text", () => {
    expect(md).toContain("desc refund-overpromise \\| with a pipe");
  });
});

describe("renderRunHtml", () => {
  const html = renderRunHtml(makeRun());

  test("is a self-contained HTML document with a per-case section", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Eval Interaction Report");
    expect(html).toContain('<span class="chip fail">FAIL</span>');
    expect(html).toContain("the draft over-promises a full refund");
  });

  test("escapes HTML in the agent output", () => {
    const withTag: EvalRunResult = makeRun();
    withTag.cases[0]!.output = "<script>alert(1)</script>";
    const out = renderRunHtml(withTag);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>alert(1)</script>");
  });
});
