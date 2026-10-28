// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/render
 *
 * Renderers for the scorecard: one-page Markdown, a self-contained printable
 * HTML page, and a compact CLI summary. Each shows the five GRADE letters with
 * their full names, every criterion under each letter, the citation behind
 * each computed criterion, and for each stub the sub-phase that fills it in.
 */

import type { Criterion, Dimension, Rating, Scorecard, StubbedCriterion } from "./types.ts";
import { RATING_LABEL } from "./types.ts";

/** Traffic-light glyph per rating, used in both Markdown and the CLI. */
const RATING_DOT: Record<Rating, string> = {
  strong: "🟢",
  adequate: "🟡",
  "at-risk": "🟠",
  critical: "🔴",
  "not-assessed": "⚪",
};

/** Print-friendly hex per rating (HTML chips). */
const RATING_COLOR: Record<Rating, string> = {
  strong: "#1a7f37",
  adequate: "#9a6700",
  "at-risk": "#bc4c00",
  critical: "#cf222e",
  "not-assessed": "#6e7781",
};

function ratingCell(rating: Rating): string {
  return `${RATING_DOT[rating]} ${RATING_LABEL[rating]}`;
}

/** "G · Governed" */
function letterName(d: Dimension): string {
  return `${d.letter} · ${d.title}`;
}

/** The one line every stub renders, wherever it appears. */
function stubLine(c: StubbedCriterion): string {
  return `Not yet assessed; fills in Phase ${c.fillsIn}.`;
}

/** One sentence on coverage: letters graded, criteria computed vs stubbed. */
function coverageLine(card: Scorecard): string {
  const { assessedCount, totalDimensions, computedCriteria, stubbedCriteria } = card.meta;
  return (
    `${assessedCount} of ${totalDimensions} GRADE letters graded from evidence; ` +
    `${computedCriteria} criteria computed, ${stubbedCriteria} not yet assessed ` +
    "(each names the sub-phase that fills it in)."
  );
}

function markdownCriterion(c: Criterion): string[] {
  const lines: string[] = [];
  lines.push(`#### ${c.title}: ${ratingCell(c.rating)}`);
  lines.push("");
  if (c.state === "stubbed") {
    lines.push(stubLine(c));
    lines.push("");
    lines.push(`- Will be computed from ${c.computedFrom}.`);
    lines.push("");
    return lines;
  }
  lines.push(c.headline);
  lines.push("");
  for (const e of c.evidence) lines.push(`- ${e}`);
  lines.push(`- **Source:** ${c.citation.source}`);
  lines.push(`- **Threshold:** ${c.citation.threshold}`);
  lines.push(`- **What would change the grade:** ${c.citation.wouldChange}`);
  lines.push("");
  return lines;
}

/** Render the scorecard as a one-page Markdown document. */
export function renderMarkdown(card: Scorecard): string {
  const lines: string[] = [];
  lines.push("# AI Reliability Scorecard");
  lines.push("");
  if (card.degraded) {
    lines.push("> ⚠️ **Degraded run:** the agent was deliberately worsened for this scorecard.");
    lines.push("");
  }
  lines.push(`**Agent:** ${card.agentTask}  `);
  lines.push(`**Model:** ${card.provider} / ${card.model}  `);
  lines.push(`**Generated:** ${card.generatedAt}  `);
  lines.push(`**Coverage:** ${coverageLine(card)}`);
  lines.push("");
  lines.push(`## Overall: ${ratingCell(card.overall.rating)}`);
  lines.push("");
  lines.push(card.overall.headline);
  lines.push("");
  lines.push("| Letter | Rating | Computed | Not yet assessed | Summary |");
  lines.push("|---|---|---|---|---|");
  for (const d of card.dimensions) {
    const computed = d.criteria.filter((c) => c.state === "computed").length;
    const stubs = d.criteria.filter((c): c is StubbedCriterion => c.state === "stubbed");
    const pending =
      stubs.length === 0 ? "none" : stubs.map((c) => `${c.title} (${c.fillsIn})`).join("; ");
    lines.push(
      `| **${letterName(d)}** | ${ratingCell(d.rating)} | ${computed} | ${pending} | ${d.headline} |`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const d of card.dimensions) {
    lines.push(`### ${letterName(d)}: ${ratingCell(d.rating)}`);
    lines.push("");
    lines.push(`_${d.question}_`);
    lines.push("");
    for (const c of d.criteria) lines.push(...markdownCriterion(c));
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "_A letter's grade is its weakest computed criterion; the overall verdict is the weakest letter. " +
      "Every computed criterion cites the record it came from; every criterion without evidence says so " +
      "and names the sub-phase that fills it in. No score is asserted without evidence._",
  );
  lines.push("");
  return lines.join("\n");
}

/** Compact CLI summary: one line per letter, then one indented line per criterion. */
export function renderCli(card: Scorecard): string {
  const lines: string[] = [];
  lines.push(`AI Reliability Scorecard: ${card.agentTask} (${card.provider}/${card.model})`);
  if (card.degraded) lines.push("⚠️  DEGRADED RUN");
  lines.push("");
  lines.push(`Overall: ${ratingCell(card.overall.rating)}. ${card.overall.headline}`);
  lines.push("");
  for (const d of card.dimensions) {
    lines.push(`  ${ratingCell(d.rating).padEnd(20)} ${letterName(d)}`);
    for (const c of d.criteria) {
      const detail = c.state === "stubbed" ? `: fills in Phase ${c.fillsIn}.` : "";
      lines.push(`      ${ratingCell(c.rating).padEnd(20)} ${c.title}${detail}`);
    }
  }
  lines.push("");
  lines.push(coverageLine(card));
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlChip(rating: Rating): string {
  const color = RATING_COLOR[rating];
  return `<span class="chip" style="background:${color}">${escapeHtml(RATING_LABEL[rating])}</span>`;
}

function htmlCriterion(c: Criterion): string {
  if (c.state === "stubbed") {
    return [
      '      <div class="crit crit--stub">',
      `        <h4>${escapeHtml(c.title)} ${htmlChip(c.rating)}</h4>`,
      `        <p class="headline">${escapeHtml(stubLine(c))}</p>`,
      `        <ul><li>Will be computed from ${escapeHtml(c.computedFrom)}.</li></ul>`,
      "      </div>",
    ].join("\n");
  }
  const evidence = c.evidence.map((e) => `          <li>${escapeHtml(e)}</li>`);
  return [
    '      <div class="crit">',
    `        <h4>${escapeHtml(c.title)} ${htmlChip(c.rating)}</h4>`,
    `        <p class="headline">${escapeHtml(c.headline)}</p>`,
    "        <ul>",
    ...evidence,
    `          <li class="cite"><b>Source:</b> ${escapeHtml(c.citation.source)}</li>`,
    `          <li class="cite"><b>Threshold:</b> ${escapeHtml(c.citation.threshold)}</li>`,
    `          <li class="cite"><b>What would change the grade:</b> ${escapeHtml(c.citation.wouldChange)}</li>`,
    "        </ul>",
    "      </div>",
  ].join("\n");
}

function htmlDimension(d: Dimension): string {
  const muted = d.assessed ? "" : " section--muted";
  return [
    `    <section class="dim${muted}">`,
    `      <h3>${escapeHtml(letterName(d))} ${htmlChip(d.rating)}</h3>`,
    `      <p class="question">${escapeHtml(d.question)}</p>`,
    ...d.criteria.map(htmlCriterion),
    "    </section>",
  ].join("\n");
}

/**
 * Render the scorecard as a self-contained, printable HTML page: inline CSS,
 * no external assets. Suitable for handing to an executive or printing to PDF.
 */
export function renderHtml(card: Scorecard): string {
  const rows = card.dimensions
    .map((d) => {
      const stubs = d.criteria.filter((c) => c.state === "stubbed").length;
      return `        <tr><td><b>${escapeHtml(letterName(d))}</b></td><td>${htmlChip(d.rating)}</td><td>${stubs}</td><td>${escapeHtml(
        d.headline,
      )}</td></tr>`;
    })
    .join("\n");
  const sections = card.dimensions.map(htmlDimension).join("\n");
  const degradedBanner = card.degraded
    ? '    <p class="banner">⚠️ Degraded run: the agent was deliberately worsened for this scorecard.</p>\n'
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Reliability Scorecard: ${escapeHtml(card.agentTask)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2328; margin: 0; padding: 2rem; max-width: 820px; margin-inline: auto;
    }
    h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
    h3 { font-size: 1.1rem; margin: 0 0 .2rem; display: flex; align-items: center; gap: .5rem; }
    h4 { font-size: .98rem; margin: .6rem 0 .25rem; display: flex; align-items: center; gap: .5rem; }
    .meta { color: #57606a; font-size: .85rem; margin: 0 0 1.25rem; }
    .meta b { color: #1f2328; font-weight: 600; }
    .overall { padding: 1rem 1.25rem; border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 1.5rem; background: #f6f8fa; }
    .overall h2 { margin: 0 0 .35rem; font-size: 1.15rem; display: flex; align-items: center; gap: .6rem; }
    .overall p { margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #d0d7de; vertical-align: top; }
    th { font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: #57606a; }
    .chip { display: inline-block; color: #fff; font-size: .78rem; font-weight: 600; padding: .12rem .5rem; border-radius: 999px; white-space: nowrap; }
    .dim { padding: .75rem 0; border-top: 1px solid #eaeef2; }
    .dim .question { margin: 0 0 .2rem; color: #57606a; font-style: italic; }
    .crit { padding-left: .75rem; border-left: 3px solid #eaeef2; margin: .4rem 0; }
    .crit .headline { margin: 0 0 .3rem; }
    .crit ul { margin: 0; padding-left: 1.2rem; color: #424a53; }
    .crit li { margin: .15rem 0; }
    .crit li.cite { color: #57606a; font-size: .88rem; }
    .crit--stub { opacity: .75; }
    .section--muted { opacity: .7; }
    .banner { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px; padding: .5rem .75rem; font-size: .9rem; }
    footer { margin-top: 1.5rem; color: #57606a; font-size: .8rem; border-top: 1px solid #eaeef2; padding-top: .75rem; }
    @media print { body { padding: 0; } .overall { background: #f6f8fa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <main>
    <h1>AI Reliability Scorecard</h1>
    <p class="meta">
      <b>Agent:</b> ${escapeHtml(card.agentTask)} &nbsp;·&nbsp;
      <b>Model:</b> ${escapeHtml(card.provider)} / ${escapeHtml(card.model)} &nbsp;·&nbsp;
      <b>Generated:</b> ${escapeHtml(card.generatedAt)}<br />
      <b>Coverage:</b> ${escapeHtml(coverageLine(card))}
    </p>
${degradedBanner}    <div class="overall">
      <h2>Overall: ${htmlChip(card.overall.rating)}</h2>
      <p>${escapeHtml(card.overall.headline)}</p>
    </div>
    <table>
      <thead><tr><th>Letter</th><th>Rating</th><th>Not yet assessed</th><th>Summary</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
${sections}
    <footer>A letter's grade is its weakest computed criterion; the overall verdict is the weakest letter. Every computed criterion cites the record it came from; every criterion without evidence names the sub-phase that fills it in.</footer>
  </main>
</body>
</html>
`;
}
