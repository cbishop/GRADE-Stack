// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { GateVerdict } from "./gate.ts";
import type { CostBreakdown } from "./pricing.ts";
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
  lines.push(formatCost(summary.cost, result.provider, result.model));
  return lines.join("\n");
}

/** One-line cost-per-success readout. Tokens always; dollars per pricing basis. */
function formatCost(cost: CostBreakdown, provider: string, model: string): string {
  const perSuccessTokens =
    cost.tokensPerSuccess === null ? "n/a" : Math.round(cost.tokensPerSuccess).toString();
  const perSuccessUsd = cost.usdPerSuccess === null ? "n/a" : `$${cost.usdPerSuccess.toFixed(5)}`;
  const basis =
    cost.basis === "free"
      ? "$0 (no per-token cost)"
      : cost.basis === "amortized"
        ? "amortized self-host rate"
        : "list price";
  return [
    `cost-per-success: ${perSuccessUsd}  (${perSuccessTokens} tokens/success)`,
    `  total $${cost.totalUsd.toFixed(5)} on ${provider}/${model} — ${basis}`,
  ].join("\n");
}

/** Render a gate verdict for the CLI / CI logs. */
export function formatGateVerdict(verdict: GateVerdict): string {
  const lines: string[] = [];
  lines.push(`eval gate: ${verdict.pass ? "PASS ✓" : "FAIL ✗"}`);
  for (const reason of verdict.reasons) {
    lines.push(`  - ${reason}`);
  }
  return lines.join("\n");
}
