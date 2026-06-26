// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/report
 *
 * Renders an eval run as a committable per-case **interaction report** — a
 * Markdown table (one row per case) and a self-contained printable HTML page,
 * each followed by a full detail block for every case: its plan/execute/validate
 * trace, every individual check (metric, pass/fail, score, and the judge's
 * reason), token usage, stability, and the agent's raw output.
 *
 * `formatRunResult` (./format.ts) is the terminal-only compact view; this is the
 * artifact form. Both read the same {@link EvalRunResult}, so the file you commit
 * and the line you see in CI trace to the identical structured data.
 */

import type { CostBreakdown } from "./pricing.ts";
import type { CaseResult, EvalRunResult, TraceCheck, TraceStep } from "./types.ts";
import { PHASES, type Phase } from "./types.ts";

const PHASE_MARK = { ok: "✓", fail: "✗", skipped: "·" } as const;
const CHECK_MARK = { true: "✓", false: "✗" } as const;

/** The trace step for a phase, or undefined when the run recorded none. */
function stepFor(c: CaseResult, phase: Phase): TraceStep | undefined {
  return c.trace.find((s) => s.phase === phase);
}

/** Per-phase status glyph for the summary table (· = no checks recorded). */
function phaseCell(c: CaseResult, phase: Phase): string {
  const step = stepFor(c, phase);
  return step ? PHASE_MARK[step.status] : "·";
}

function tokens(c: CaseResult): string {
  return `${c.usage.inputTokens}+${c.usage.outputTokens}`;
}

/** One-line cost summary shared by both renderers. */
function costLine(cost: CostBreakdown, provider: string, model: string): string {
  const perTok =
    cost.tokensPerSuccess === null ? "n/a" : Math.round(cost.tokensPerSuccess).toString();
  const perUsd = cost.usdPerSuccess === null ? "n/a" : `$${cost.usdPerSuccess.toFixed(5)}`;
  const basis =
    cost.basis === "free"
      ? "$0 (no per-token cost)"
      : cost.basis === "amortized"
        ? "amortized self-host rate"
        : "list price";
  return `cost-per-success ${perUsd} (${perTok} tokens) · total $${cost.totalUsd.toFixed(5)} on ${provider}/${model} — ${basis}`;
}

/** Escape the pipe and newlines that would break a Markdown table cell. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** A fenced code block whose fence is always longer than any backtick run inside. */
function fence(body: string): string {
  const longest = (body.match(/`+/g) ?? []).reduce((m, run) => Math.max(m, run.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}\n${body}\n${ticks}`;
}

function checkLineMd(chk: TraceCheck): string {
  const reason = chk.reason ? ` — ${cell(chk.reason)}` : "";
  return `  - \`${chk.metric}\` ${CHECK_MARK[`${chk.pass}`]} score ${chk.score.toFixed(2)}${reason}`;
}

/** Render an eval run as a one-page-per-case Markdown interaction report. */
export function renderRunMarkdown(result: EvalRunResult): string {
  const { summary } = result;
  const lines: string[] = [];
  lines.push("# Eval Interaction Report");
  lines.push("");
  lines.push(`**Agent:** ${result.provider} / ${result.model}  `);
  lines.push(`**Judge:** ${result.judgeProvider}  `);
  lines.push(`**Generated:** ${result.timestamp}  `);
  lines.push(
    `**Result:** ${summary.passed}/${summary.total} passed (${Math.round(summary.passRate * 100)}%) · ` +
      `mean stability ${summary.meanStability.toFixed(2)} · ` +
      `tokens in=${summary.usage.inputTokens} out=${summary.usage.outputTokens}  `,
  );
  lines.push(`**Cost:** ${costLine(summary.cost, result.provider, result.model)}`);
  lines.push("");

  lines.push("## Cases");
  lines.push("");
  lines.push("| # | Case | Result | Plan | Execute | Validate | Tokens (in+out) | Stability |");
  lines.push("|---|---|---|---|---|---|---|---|");
  result.cases.forEach((c, i) => {
    const mark = c.pass ? "✅ PASS" : "❌ FAIL";
    lines.push(
      `| ${i + 1} | ${cell(c.id)} | ${mark} | ${phaseCell(c, "plan")} | ${phaseCell(c, "execute")} | ` +
        `${phaseCell(c, "validate")} | ${tokens(c)} | ${c.stability.toFixed(2)} |`,
    );
  });
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Per-case detail");
  lines.push("");
  for (const c of result.cases) {
    lines.push(`### ${c.id} — ${c.pass ? "✅ PASS" : "❌ FAIL"}`);
    lines.push("");
    lines.push(`${cell(c.description)}  `);
    lines.push(
      `_score ${c.score.toFixed(2)} · tokens ${tokens(c)} · stability ${c.stability.toFixed(2)} (${c.repeats} repeat${c.repeats === 1 ? "" : "s"})_`,
    );
    lines.push("");
    for (const phase of PHASES) {
      const step = stepFor(c, phase);
      if (!step) {
        lines.push(`- **${phase}** · no checks recorded`);
        continue;
      }
      lines.push(`- **${phase}** ${PHASE_MARK[step.status]} ${step.status}`);
      for (const chk of step.checks) {
        lines.push(checkLineMd(chk));
      }
    }
    lines.push("");
    lines.push("**Agent output:**");
    lines.push("");
    lines.push(fence(c.output.length > 0 ? c.output : "(empty)"));
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "_Every row traces to the structured eval results (`reliability eval run --out`); no outcome is shown without the checks that produced it._",
  );
  lines.push("");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function checkLineHtml(chk: TraceCheck): string {
  const reason = chk.reason ? ` — ${escapeHtml(chk.reason)}` : "";
  const cls = chk.pass ? "ok" : "fail";
  return `        <li class="${cls}"><code>${escapeHtml(chk.metric)}</code> ${CHECK_MARK[`${chk.pass}`]} score ${chk.score.toFixed(2)}${reason}</li>`;
}

function caseSectionHtml(c: CaseResult): string {
  const phases = PHASES.map((phase) => {
    const step = stepFor(c, phase);
    if (!step) return `      <p class="phase">· <b>${phase}</b> — no checks recorded</p>`;
    const checks = step.checks.map(checkLineHtml).join("\n");
    return [
      `      <p class="phase">${PHASE_MARK[step.status]} <b>${phase}</b> — ${step.status}</p>`,
      checks ? `      <ul>\n${checks}\n      </ul>` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n");

  return [
    `    <section class="case ${c.pass ? "pass" : "fail"}">`,
    `      <h3>${escapeHtml(c.id)} <span class="chip ${c.pass ? "pass" : "fail"}">${c.pass ? "PASS" : "FAIL"}</span></h3>`,
    `      <p class="desc">${escapeHtml(c.description)}</p>`,
    `      <p class="meta">score ${c.score.toFixed(2)} · tokens ${tokens(c)} · stability ${c.stability.toFixed(2)} (${c.repeats} repeat${c.repeats === 1 ? "" : "s"})</p>`,
    phases,
    '      <p class="meta">Agent output:</p>',
    `      <pre>${escapeHtml(c.output.length > 0 ? c.output : "(empty)")}</pre>`,
    "    </section>",
  ].join("\n");
}

/** Render an eval run as a self-contained, printable HTML interaction report. */
export function renderRunHtml(result: EvalRunResult): string {
  const { summary } = result;
  const rows = result.cases
    .map((c, i) => {
      const cells = [
        `${i + 1}`,
        escapeHtml(c.id),
        `<span class="chip ${c.pass ? "pass" : "fail"}">${c.pass ? "PASS" : "FAIL"}</span>`,
        phaseCell(c, "plan"),
        phaseCell(c, "execute"),
        phaseCell(c, "validate"),
        tokens(c),
        c.stability.toFixed(2),
      ];
      return `        <tr><td>${cells.join("</td><td>")}</td></tr>`;
    })
    .join("\n");
  const sections = result.cases.map(caseSectionHtml).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Eval Interaction Report — ${escapeHtml(result.provider)}/${escapeHtml(result.model)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2328; margin: 0; padding: 2rem; max-width: 900px; margin-inline: auto; }
    h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
    .meta { color: #57606a; font-size: .85rem; margin: .1rem 0; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; font-size: .9rem; }
    th, td { text-align: left; padding: .4rem .55rem; border-bottom: 1px solid #d0d7de; }
    th { font-size: .75rem; text-transform: uppercase; letter-spacing: .03em; color: #57606a; }
    .chip { display: inline-block; color: #fff; font-size: .72rem; font-weight: 600; padding: .08rem .45rem; border-radius: 999px; }
    .chip.pass { background: #1a7f37; }
    .chip.fail { background: #cf222e; }
    .case { border-top: 1px solid #eaeef2; padding: .75rem 0; }
    .case.fail { background: #fff8f8; }
    .case h3 { font-size: 1.05rem; margin: 0 0 .25rem; display: flex; align-items: center; gap: .5rem; }
    .case .desc { margin: .1rem 0 .4rem; }
    .case .phase { margin: .35rem 0 .1rem; }
    .case ul { margin: .1rem 0 .4rem; padding-left: 1.3rem; color: #424a53; }
    .case li.fail { color: #cf222e; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: .6rem .75rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: .82rem; }
    @media print { body { padding: 0; } .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <main>
    <h1>Eval Interaction Report</h1>
    <p class="meta"><b>Agent:</b> ${escapeHtml(result.provider)} / ${escapeHtml(result.model)} &nbsp;·&nbsp; <b>Judge:</b> ${escapeHtml(result.judgeProvider)} &nbsp;·&nbsp; <b>Generated:</b> ${escapeHtml(result.timestamp)}</p>
    <p class="meta"><b>Result:</b> ${summary.passed}/${summary.total} passed (${Math.round(summary.passRate * 100)}%) · mean stability ${summary.meanStability.toFixed(2)} · tokens in=${summary.usage.inputTokens} out=${summary.usage.outputTokens}</p>
    <p class="meta"><b>Cost:</b> ${escapeHtml(costLine(summary.cost, result.provider, result.model))}</p>
    <table>
      <thead><tr><th>#</th><th>Case</th><th>Result</th><th>Plan</th><th>Execute</th><th>Validate</th><th>Tokens</th><th>Stability</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
${sections}
    <footer class="meta" style="margin-top:1.5rem;border-top:1px solid #eaeef2;padding-top:.75rem;">Every row traces to the structured eval results — no outcome is shown without the checks that produced it.</footer>
  </main>
</body>
</html>
`;
}
