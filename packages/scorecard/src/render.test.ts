// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { renderCli, renderHtml, renderMarkdown } from "./render.ts";
import type { Scorecard } from "./types.ts";

const CARD: Scorecard = {
  generatedAt: "2026-06-13T00:00:00.000Z",
  agentTask: "Support-email triage",
  provider: "stub",
  model: "stub-deterministic-v1",
  degraded: false,
  overall: { rating: "strong", headline: "Looks production-ready." },
  dimensions: [
    {
      key: "reliability",
      title: "Reliability",
      rating: "strong",
      headline: "Handles its task dependably.",
      evidence: ["12 of 12 test cases passed (100%)."],
      assessed: true,
    },
    {
      key: "observability",
      title: "Observability coverage",
      rating: "not-assessed",
      headline: "Not yet assessed.",
      evidence: ["Computed in Phase 2D."],
      assessed: false,
      plannedPhase: "Phase 2D",
    },
  ],
  meta: { assessedCount: 1, totalDimensions: 2 },
};

describe("renderMarkdown", () => {
  test("renders a one-page document with overall, table, and per-dimension sections", () => {
    const md = renderMarkdown(CARD);
    expect(md).toContain("# AI Reliability Scorecard");
    expect(md).toContain("## Overall: 🟢 Strong");
    expect(md).toContain("| Dimension | Rating | Summary |");
    expect(md).toContain("### Reliability — 🟢 Strong");
    expect(md).toContain("12 of 12 test cases passed");
    expect(md).toContain("Not yet assessed");
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
    expect(html).toContain("print-color-adjust"); // print-friendly
    expect(html).toContain("Reliability");
    expect(html).toContain("Support-email triage");
  });

  test("escapes HTML-significant characters in content", () => {
    const html = renderHtml({
      ...CARD,
      agentTask: "A & B <script>",
    });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("renderCli", () => {
  test("summarizes every dimension and the coverage count", () => {
    const cli = renderCli(CARD);
    expect(cli).toContain("Overall:");
    expect(cli).toContain("Reliability");
    expect(cli).toContain("Observability coverage");
    expect(cli).toContain("1/2 dimensions assessed");
  });
});
