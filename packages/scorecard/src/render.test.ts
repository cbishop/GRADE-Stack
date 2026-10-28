// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/render.test
 *
 * Tests for the scorecard renderers: the five GRADE letters with full names,
 * per-criterion citations, the "fills in Phase 4X" stub line, the degraded
 * banner, self-contained printable HTML with escaping, and the CLI summary.
 */

import { describe, expect, test } from "bun:test";
import { renderCli, renderHtml, renderMarkdown } from "./render.ts";
import type { Dimension, Scorecard } from "./types.ts";

const COMPUTED_R: Dimension = {
  id: "reliable",
  letter: "R",
  title: "Reliable",
  question: "Does the agent behave consistently?",
  rating: "strong",
  headline: "Handles its task dependably.",
  assessed: true,
  criteria: [
    {
      state: "computed",
      key: "reliability",
      title: "Reliability",
      rating: "strong",
      headline: "Handles its task dependably.",
      evidence: ["12 of 12 test cases passed (100%)."],
      citation: {
        source: "results.json (stub/stub-1, run 2026-06-13T00:00:00.000Z)",
        threshold: "Pass rate: Strong ≥90%.",
        wouldChange: "Drops to Adequate below a 90% pass rate.",
      },
    },
  ],
};

const MIXED_D: Dimension = {
  id: "deployed",
  letter: "D",
  title: "Deployed",
  question: "Can a team run it, see what it did, and undo a bad release?",
  rating: "strong",
  headline: "One connected trace.",
  assessed: true,
  criteria: [
    {
      state: "computed",
      key: "observability",
      title: "Observability coverage",
      rating: "strong",
      headline: "One connected trace.",
      evidence: ["5 spans."],
      citation: { source: "trace probe", threshold: "3/3 phases", wouldChange: "fragmenting" },
    },
    {
      state: "stubbed",
      key: "rollback",
      title: "Rollback verified",
      rating: "not-assessed",
      fillsIn: "4C",
      computedFrom: "a dated kill-switch drill record",
    },
  ],
};

const CARD: Scorecard = {
  generatedAt: "2026-06-13T00:00:00.000Z",
  agentTask: "Support-email triage",
  provider: "stub",
  model: "stub-deterministic-v1",
  degraded: false,
  overall: { rating: "strong", headline: "Looks production-ready." },
  dimensions: [COMPUTED_R, MIXED_D],
  meta: { assessedCount: 2, totalDimensions: 2, computedCriteria: 2, stubbedCriteria: 1 },
};

describe("renderMarkdown", () => {
  test("renders the overall verdict, the letter table, and per-letter criteria", () => {
    const md = renderMarkdown(CARD);
    expect(md).toContain("# AI Reliability Scorecard");
    expect(md).toContain("## Overall: 🟢 Strong");
    expect(md).toContain("| Letter | Rating | Computed | Not yet assessed | Summary |");
    expect(md).toContain("| **R · Reliable** | 🟢 Strong | 1 | none |");
    expect(md).toContain("Rollback verified (4C)");
    expect(md).toContain("### R · Reliable: 🟢 Strong");
    expect(md).toContain("#### Reliability: 🟢 Strong");
    expect(md).toContain("12 of 12 test cases passed");
  });

  test("every computed criterion shows its source, threshold, and what would change it", () => {
    const md = renderMarkdown(CARD);
    expect(md).toContain("**Source:** results.json");
    expect(md).toContain("**Threshold:** Pass rate");
    expect(md).toContain("**What would change the grade:** Drops to Adequate");
  });

  test("every stub says it is not yet assessed and names the sub-phase that fills it in", () => {
    const md = renderMarkdown(CARD);
    expect(md).toContain("#### Rollback verified: ⚪ Not yet assessed");
    expect(md).toContain("Not yet assessed; fills in Phase 4C.");
    expect(md).toContain("Will be computed from a dated kill-switch drill record.");
  });

  test("shows the degraded banner only when degraded", () => {
    expect(renderMarkdown(CARD)).not.toContain("Degraded run");
    expect(renderMarkdown({ ...CARD, degraded: true })).toContain("Degraded run");
  });
});

describe("renderHtml", () => {
  test("is a self-contained, printable HTML page", () => {
    const html = renderHtml(CARD);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("print-color-adjust");
    expect(html).toContain("R · Reliable");
    expect(html).toContain("Not yet assessed; fills in Phase 4C.");
    expect(html).toContain("Support-email triage");
  });

  test("escapes HTML-significant characters in content", () => {
    const html = renderHtml({ ...CARD, agentTask: "A & B <script>" });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("renderCli", () => {
  test("summarizes every letter, every criterion, and the coverage count", () => {
    const cli = renderCli(CARD);
    expect(cli).toContain("Overall:");
    expect(cli).toContain("R · Reliable");
    expect(cli).toContain("D · Deployed");
    expect(cli).toContain("Observability coverage");
    expect(cli).toContain("Rollback verified: fills in Phase 4C.");
    expect(cli).toContain(
      "2 of 2 GRADE letters graded from evidence; 2 criteria computed, 1 not yet assessed",
    );
  });
});
