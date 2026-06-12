// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { CaseResult, EvalRunResult, TraceStep } from "./types.ts";

const STATUS_MARK: Record<TraceStep["status"], string> = {
  ok: "✓",
  fail: "✗",
  skipped: "·",
};

function formatTrace(trace: TraceStep[]): string {
  return trace.map((step) => `${STATUS_MARK[step.status]} ${step.phase}`).join("  ");
}

function formatCase(c: CaseResult): string {
  const mark = c.pass ? "PASS" : "FAIL";
  const stab = c.repeats > 1 ? `  stability=${c.stability.toFixed(2)}` : "";
  return `  ${mark}  ${c.id.padEnd(28)} ${formatTrace(c.trace)}${stab}`;
}

/** Render a human-readable summary of an eval run for the CLI. */
export function formatRunResult(result: EvalRunResult): string {
  const { summary } = result;
  const lines: string[] = [];
  lines.push(`agent provider: ${result.provider}    judge provider: ${result.judgeProvider}`);
  lines.push("");
  lines.push("phases:  plan  execute  validate    (· = no checks for this phase yet)");
  lines.push("");
  for (const c of result.cases) {
    lines.push(formatCase(c));
  }
  lines.push("");
  lines.push(
    `${summary.passed}/${summary.total} cases passed (${(summary.passRate * 100).toFixed(0)}%)`,
  );
  if (result.cases.some((c) => c.repeats > 1)) {
    lines.push(`mean stability: ${summary.meanStability.toFixed(2)} (1.00 = no flakiness)`);
  }
  lines.push(
    `tokens: in=${summary.usage.inputTokens} out=${summary.usage.outputTokens} (agent only)`,
  );
  return lines.join("\n");
}
