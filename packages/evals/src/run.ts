// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProvider, resolveProviderName } from "@grade-stack/core";
import { computeCost } from "./pricing.ts";
import {
  type CaseResult,
  type EvalRunResult,
  PHASES,
  type Phase,
  type StepStatus,
  type TraceCheck,
  type TraceStep,
} from "./types.ts";

const PKG_ROOT = resolve(import.meta.dir, "..");
const CONFIG_PATH = join(PKG_ROOT, "promptfooconfig.yaml");

export interface RunEvalOptions {
  /** Provider for the agent under test. Resolved like the CLI (env/default). */
  provider?: string;
  /** Provider for the LLM-as-judge metrics. Defaults to the agent provider. */
  judgeProvider?: string;
  /** Times each case is run, for flakiness measurement. Default 1. */
  repeats?: number;
  /** promptfoo concurrency. Default 3 (Ollama contends above this). */
  concurrency?: number;
  /** Run only the first N cases (smoke runs). */
  firstN?: number;
}

/** The subset of promptfoo's output JSON we depend on. */
interface PromptfooOutput {
  results: { results: PromptfooRow[] };
}

export interface PromptfooRow {
  success: boolean;
  score: number;
  testCase: { description?: string };
  response?: { output?: string };
  tokenUsage?: { prompt?: number; completion?: number };
  gradingResult?: { componentResults?: PromptfooComponent[] };
}

export interface PromptfooComponent {
  pass: boolean;
  score: number;
  reason?: string;
  assertion?: { metric?: string; type?: string };
}

/** Map an assertion's metric name to its planner/executor/validator phase. */
function phaseOf(metric: string): Phase {
  const prefix = metric.split(":")[0];
  if (prefix === "plan" || prefix === "execute" || prefix === "validate") {
    return prefix;
  }
  // Unprefixed assertions are validator-side checks by default.
  return "validate";
}

/** Build the planner/executor/validator trace for one case from its checks. */
export function buildTrace(components: PromptfooComponent[]): TraceStep[] {
  const checks: TraceCheck[] = components.map((c) => ({
    metric: c.assertion?.metric ?? c.assertion?.type ?? "unknown",
    pass: c.pass,
    score: c.score,
    reason: c.reason,
  }));

  return PHASES.map((phase): TraceStep => {
    const phaseChecks = checks.filter((c) => phaseOf(c.metric) === phase);
    let status: StepStatus;
    if (phaseChecks.length === 0) {
      // No checks for this phase — e.g. the naive agent has no planner yet.
      status = "skipped";
    } else {
      status = phaseChecks.every((c) => c.pass) ? "ok" : "fail";
    }
    return { phase, status, checks: phaseChecks };
  });
}

const EMPTY_ROW: PromptfooRow = { success: false, score: 0, testCase: {} };

/** Collapse N repeats of one case into a single CaseResult with a stability score. */
export function foldCase(id: string, rows: PromptfooRow[]): CaseResult {
  const repeats = rows.length;
  const passes = rows.filter((r) => r.success).length;
  const majorityPass = passes * 2 >= repeats;
  // Stability: fraction of repeats agreeing with the majority outcome.
  const agreeing = majorityPass ? passes : repeats - passes;
  const stability = repeats === 0 ? 1 : agreeing / repeats;

  const last = rows[rows.length - 1] ?? EMPTY_ROW;
  const inputTokens = rows.reduce((sum, r) => sum + (r.tokenUsage?.prompt ?? 0), 0);
  const outputTokens = rows.reduce((sum, r) => sum + (r.tokenUsage?.completion ?? 0), 0);
  const meanScore = repeats === 0 ? 0 : rows.reduce((s, r) => s + r.score, 0) / repeats;

  return {
    id,
    description: id,
    pass: majorityPass,
    score: meanScore,
    trace: buildTrace(last.gradingResult?.componentResults ?? []),
    output: last.response?.output ?? "",
    usage: { inputTokens, outputTokens },
    stability,
    repeats,
  };
}

function normalize(
  output: PromptfooOutput,
  provider: string,
  model: string,
  judgeProvider: string,
): Omit<EvalRunResult, "timestamp"> {
  const byCase = new Map<string, PromptfooRow[]>();
  for (const row of output.results.results) {
    const id = row.testCase.description ?? "unnamed";
    const list = byCase.get(id);
    if (list) {
      list.push(row);
    } else {
      byCase.set(id, [row]);
    }
  }

  const cases: CaseResult[] = [...byCase.entries()].map(([id, rows]) => foldCase(id, rows));

  const passed = cases.filter((c) => c.pass).length;
  const inputTokens = cases.reduce((s, c) => s + c.usage.inputTokens, 0);
  const outputTokens = cases.reduce((s, c) => s + c.usage.outputTokens, 0);
  const meanStability =
    cases.length === 0 ? 1 : cases.reduce((s, c) => s + c.stability, 0) / cases.length;

  const usage = { inputTokens, outputTokens };

  return {
    provider,
    model,
    judgeProvider,
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      passRate: cases.length === 0 ? 0 : passed / cases.length,
      meanStability,
      usage,
      cost: computeCost(provider, model, usage, passed),
    },
    cases,
  };
}

/** Spawn promptfoo and return the path it wrote, or throw on a real failure. */
function spawnPromptfoo(outPath: string, opts: RunEvalOptions): Promise<void> {
  const provider = resolveProviderName(opts.provider);
  const judgeProvider = resolveProviderName(opts.judgeProvider ?? opts.provider);
  const args = [
    "x",
    "promptfoo",
    "eval",
    "-c",
    CONFIG_PATH,
    "--no-cache",
    "--repeat",
    String(opts.repeats ?? 1),
    "-j",
    String(opts.concurrency ?? 3),
    "-o",
    outPath,
  ];
  if (opts.firstN !== undefined) {
    args.push("--filter-first-n", String(opts.firstN));
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn("bun", args, {
      cwd: PKG_ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        EVAL_AGENT_PROVIDER: provider,
        EVAL_JUDGE_PROVIDER: judgeProvider,
      },
    });
    child.on("error", reject);
    // promptfoo exits non-zero when cases FAIL (exit 100). That is a normal
    // result, not a harness error — we judge success by whether it wrote output.
    child.on("close", () => resolvePromise());
  });
}

/**
 * Run the full eval suite through promptfoo and return structured results.
 * Both the agent and the judge run through `@grade-stack/core` (see
 * src/bridge.ts). promptfoo's exit code is ignored on purpose — failing cases
 * are data, not errors; we only fail if no parseable output was produced.
 */
export async function runEvalSuite(opts: RunEvalOptions = {}): Promise<EvalRunResult> {
  const provider = resolveProviderName(opts.provider);
  const judgeProvider = resolveProviderName(opts.judgeProvider ?? opts.provider);
  // Resolve the agent model id through the abstraction (no network at
  // construction) so cost pricing has the exact model the run used.
  const model = createProvider(provider).model;
  const outPath = join(tmpdir(), `grade-stack-eval-${process.pid}.json`);

  try {
    await spawnPromptfoo(outPath, opts);
    let raw: string;
    try {
      raw = await readFile(outPath, "utf8");
    } catch {
      throw new Error(
        "promptfoo produced no output file — the eval run failed before writing results.",
      );
    }
    const parsed = JSON.parse(raw) as PromptfooOutput;
    const normalized = normalize(parsed, provider, model, judgeProvider);
    return { ...normalized, timestamp: new Date().toISOString() };
  } finally {
    await rm(outPath, { force: true }).catch(() => {});
  }
}
