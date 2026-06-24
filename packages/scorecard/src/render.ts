// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/render
 *
 * Renderers for the scorecard — one-page Markdown, a self-contained printable
 * HTML page, and a one-line-per-dimension CLI summary.
 */

import type { Dimension, Rating, Scorecard } from "./types.ts";
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

/** Render the scorecard as a one-page Markdown document. */
export function renderMarkdown(card: Scorecard): string {
  const lines: string[] = [];
  lines.push("# AI Reliability Scorecard");
  lines.push("");
  if (card.degraded) {
    lines.push("> ⚠️ **Degraded run** — the agent was deliberately worsened for this scorecard.");
    lines.push("");
  }
  lines.push(`**Agent:** ${card.agentTask}  `);
  lines.push(`**Model:** ${card.provider} / ${card.model}  `);
  lines.push(`**Generated:** ${card.generatedAt}  `);
  const allAssessed = card.meta.assessedCount === card.meta.totalDimensions;
  lines.push(
    `**Coverage:** ${card.meta.assessedCount} of ${card.meta.totalDimensions} dimensions assessed` +
      (allAssessed
        ? " — every dimension is now computed from evidence."
        : " today — the rest are computed in later phases and shown as *not yet assessed*."),
  );
  lines.push("");
  lines.push(`## Overall: ${ratingCell(card.overall.rating)}`);
  lines.push("");
  lines.push(card.overall.headline);
  lines.push("");
  lines.push("| Dimension | Rating | Summary |");
  lines.push("|---|---|---|");
  for (const d of card.dimensions) {
    lines.push(`| ${d.title} | ${ratingCell(d.rating)} | ${d.headline} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const d of card.dimensions) {
    lines.push(`### ${d.title} — ${ratingCell(d.rating)}`);
    lines.push("");
    lines.push(d.headline);
    lines.push("");
    for (const e of d.evidence) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "_Every rating above is computed from the eval suite — no score is asserted without the evidence shown beneath it._",
  );
  lines.push("");
  return lines.join("\n");
}

/** One-line CLI summary per dimension (re-uses the traffic-light glyphs). */
export function renderCli(card: Scorecard): string {
  const lines: string[] = [];
  lines.push(`AI Reliability Scorecard — ${card.agentTask} (${card.provider}/${card.model})`);
  if (card.degraded) lines.push("⚠️  DEGRADED RUN");
  lines.push("");
  lines.push(`Overall: ${ratingCell(card.overall.rating)} — ${card.overall.headline}`);
  lines.push("");
  for (const d of card.dimensions) {
    lines.push(`  ${ratingCell(d.rating).padEnd(20)} ${d.title}`);
  }
  lines.push("");
  lines.push(
    card.meta.assessedCount === card.meta.totalDimensions
      ? `${card.meta.assessedCount}/${card.meta.totalDimensions} dimensions assessed — all computed from evidence.`
      : `${card.meta.assessedCount}/${card.meta.totalDimensions} dimensions assessed; the rest land in later phases.`,
  );
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

function htmlDimension(d: Dimension): string {
  const evidence = d.evidence.map((e) => `      <li>${escapeHtml(e)}</li>`).join("\n");
  const muted = d.assessed ? "" : " section--muted";
  return [
    `    <section class="dim${muted}">`,
    `      <h3>${escapeHtml(d.title)} ${htmlChip(d.rating)}</h3>`,
    `      <p class="headline">${escapeHtml(d.headline)}</p>`,
    "      <ul>",
    evidence,
    "      </ul>",
    "    </section>",
  ].join("\n");
}

/**
 * Render the scorecard as a self-contained, printable HTML page — inline CSS,
 * no external assets, fits one page. Suitable for handing to an executive or
 * printing to PDF.
 */
export function renderHtml(card: Scorecard): string {
  const rows = card.dimensions
    .map(
      (d) =>
        `        <tr><td>${escapeHtml(d.title)}</td><td>${htmlChip(d.rating)}</td><td>${escapeHtml(
          d.headline,
        )}</td></tr>`,
    )
    .join("\n");
  const sections = card.dimensions.map(htmlDimension).join("\n");
  const degradedBanner = card.degraded
    ? '    <p class="banner">⚠️ Degraded run — the agent was deliberately worsened for this scorecard.</p>\n'
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Reliability Scorecard — ${escapeHtml(card.agentTask)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2328; margin: 0; padding: 2rem; max-width: 820px; margin-inline: auto;
    }
    h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
    h3 { font-size: 1.05rem; margin: 0 0 .35rem; display: flex; align-items: center; gap: .5rem; }
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
    .dim .headline { margin: 0 0 .4rem; }
    .dim ul { margin: 0; padding-left: 1.2rem; color: #424a53; }
    .dim li { margin: .15rem 0; }
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
      <b>Coverage:</b> ${card.meta.assessedCount} of ${card.meta.totalDimensions} dimensions assessed${
        card.meta.assessedCount === card.meta.totalDimensions
          ? " — every dimension is now computed from evidence."
          : " today; the rest are computed in later phases."
      }
    </p>
${degradedBanner}    <div class="overall">
      <h2>Overall: ${htmlChip(card.overall.rating)}</h2>
      <p>${escapeHtml(card.overall.headline)}</p>
    </div>
    <table>
      <thead><tr><th>Dimension</th><th>Rating</th><th>Summary</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
${sections}
    <footer>Every rating is computed from the eval suite — no score is asserted without the evidence shown beneath it.</footer>
  </main>
</body>
</html>
`;
}
