// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/traces
 *
 * Post-deployment re-scoring (Phase 4F, ADR 0021). Reads the 4B content-capture
 * directory (one JSON per gateway request, `RELIABILITY_CAPTURE_DIR`) through
 * the capture schema, turns each captured triage answer into a replay case, and
 * runs it through the suite's own default assertions, the LLM judge included,
 * with promptfoo. Nothing calls the agent: the captured output is replayed
 * through the bridge (`mode: "replay"`), so the score is of what production
 * actually returned. The result is stamped `source: "traces"` and every case
 * carries its request id, which joins it to the decision log, the trace and any
 * review item. Per-case expected labels (category, sentiment) do not apply:
 * production traffic has none.
 */

import { writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resolveProviderName } from "@grade-stack/core";
import { CaptureRecordSchema } from "@grade-stack/gateway";
import { TRIAGE_PROMPT_LEAD } from "reference-agent";
import {
  evalsRoot,
  normalizeRows,
  type PromptfooRow,
  readPromptfooRows,
  spawnPromptfoo,
  suiteConfigPath,
} from "./run.ts";
import type { EvalRunResult, TraceSkip } from "./types.ts";

/** One captured triage answer, ready to re-score. */
export interface TraceCase {
  /** Case id: the capture file's name without `.json` (`<requestId>` or `<requestId>.<n>`). */
  id: string;
  file: string;
  requestId: string;
  callerId: string | null;
  /** When the gateway captured it. */
  at: string;
  target: string;
  /** The last user message the agent sent (the triage prompt with the email). */
  prompt: string;
  /** What the caller received, after output redaction. */
  output: string;
}

/** The capture directory read: cases to re-score, and what was skipped and why. */
export interface LoadedTraces {
  dir: string;
  captures: number;
  cases: TraceCase[];
  skipped: TraceSkip[];
}

/** A promptfoo test that replays one captured answer. */
export interface TraceTest {
  description: string;
  vars: { email_body: string; captured_output: string; request_id: string };
}

/** `<id>.json` sorts as `<id>` numbered 1; `<id>.<n>.json` as `<id>` numbered n. */
function captureOrder(id: string, requestId: string): number {
  const n = Number.parseInt(id.slice(requestId.length + 1), 10);
  return id === requestId || Number.isNaN(n) ? 1 : n;
}

/**
 * Read every `*.json` capture in `dir`, validated by the 4B capture schema. A
 * malformed capture fails loudly, naming the file: re-scoring a partial sample
 * would overstate production quality. Requests with no output (blocked or
 * failed) and requests that are not triage prompts (the MCP tool-selection
 * call) are skipped with a reason.
 */
export async function loadTraceCases(dir: string): Promise<LoadedTraces> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const cases: TraceCase[] = [];
  const skipped: TraceSkip[] = [];
  for (const file of files) {
    const path = join(dir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      throw new Error(
        `${path}: not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const check = CaptureRecordSchema.safeParse(parsed);
    if (!check.success) {
      const issues = check.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`${path}: malformed capture record: ${issues}`);
    }
    const record = check.data;
    if (record.output === null) {
      skipped.push({
        file,
        requestId: record.requestId,
        reason: "no output returned (a blocked or failed request)",
      });
      continue;
    }
    const prompt = [...record.request.messages].reverse().find((m) => m.role === "user")?.content;
    if (!prompt?.startsWith(TRIAGE_PROMPT_LEAD)) {
      skipped.push({
        file,
        requestId: record.requestId,
        reason: "not a triage request (the suite's assertions grade triage answers only)",
      });
      continue;
    }
    cases.push({
      id: basename(file, ".json"),
      file,
      requestId: record.requestId,
      callerId: record.callerId,
      at: record.at,
      target: record.target,
      prompt,
      output: record.output,
    });
  }
  cases.sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      a.requestId.localeCompare(b.requestId) ||
      captureOrder(a.id, a.requestId) - captureOrder(b.id, b.requestId),
  );
  skipped.sort((a, b) => a.file.localeCompare(b.file));
  return { dir, captures: files.length, cases, skipped };
}

/** One replay test per captured answer; the suite's `defaultTest` assertions apply. */
export function traceTests(cases: TraceCase[]): TraceTest[] {
  return cases.map((c) => ({
    description: c.id,
    vars: { email_body: c.prompt, captured_output: c.output, request_id: c.requestId },
  }));
}

/** Fold promptfoo's re-score rows into a result stamped `source: "traces"`. */
export function stampTraceResult(
  rows: PromptfooRow[],
  loaded: LoadedTraces,
  opts: { dir: string; judgeProvider: string; timestamp: string },
): EvalRunResult {
  const normalized = normalizeRows(rows, "traces", "captured", opts.judgeProvider);
  const byId = new Map(loaded.cases.map((c, i) => [c.id, { c, i }]));
  const cases = normalized.cases
    .map((k) => {
      const hit = byId.get(k.id);
      return hit ? { ...k, requestId: hit.c.requestId, callerId: hit.c.callerId } : k;
    })
    .sort((a, b) => (byId.get(a.id)?.i ?? 0) - (byId.get(b.id)?.i ?? 0));
  const times = loaded.cases.map((c) => c.at).sort();
  return {
    ...normalized,
    cases,
    timestamp: opts.timestamp,
    source: "traces",
    traces: {
      dir: opts.dir,
      captures: loaded.captures,
      rescored: loaded.cases.length,
      skipped: loaded.skipped,
      firstCapturedAt: times[0] ?? null,
      lastCapturedAt: times[times.length - 1] ?? null,
    },
  };
}

/** Options for {@link runTraceRescore}. */
export interface TraceRescoreOptions {
  /** The 4B capture directory. */
  dir: string;
  /** Provider for the LLM judge (resolved like the CLI). */
  judgeProvider?: string;
  /** promptfoo concurrency. Default 3. */
  concurrency?: number;
}

/**
 * Re-score a capture directory through the suite's default assertions. Throws
 * when the directory holds nothing to re-score, rather than reporting an empty
 * sample as a pass.
 */
export async function runTraceRescore(opts: TraceRescoreOptions): Promise<EvalRunResult> {
  const judgeProvider = resolveProviderName(opts.judgeProvider);
  const loaded = await loadTraceCases(opts.dir);
  if (loaded.cases.length === 0) {
    throw new Error(
      `no captured triage answers to re-score in ${opts.dir} (${loaded.captures} capture file(s), ${loaded.skipped.length} skipped)`,
    );
  }

  const root = evalsRoot();
  const suite = Bun.YAML.parse(await readFile(suiteConfigPath(), "utf8")) as {
    prompts: unknown;
    defaultTest: {
      options?: { provider?: Record<string, unknown> } & Record<string, unknown>;
    } & Record<string, unknown>;
  };
  const providerId = `file://${join(root, "providers", "agent-provider.js")}`;
  const config = {
    description: "GRADE-Stack re-score of captured production traces (Phase 4F)",
    prompts: suite.prompts,
    providers: [{ id: providerId, label: "captured-output", config: { mode: "replay" } }],
    defaultTest: {
      ...suite.defaultTest,
      options: {
        ...suite.defaultTest.options,
        provider: { ...suite.defaultTest.options?.provider, id: providerId },
      },
    },
    tests: traceTests(loaded.cases),
  };

  const stem = join(tmpdir(), `grade-stack-rescore-${process.pid}-${Date.now()}`);
  const configPath = `${stem}.config.json`;
  const outPath = `${stem}.out.json`;
  writeFileSync(configPath, JSON.stringify(config));
  try {
    await spawnPromptfoo(
      outPath,
      { provider: judgeProvider, judgeProvider, concurrency: opts.concurrency },
      configPath,
    );
    const rows = await readPromptfooRows(outPath);
    return stampTraceResult(rows, loaded, {
      dir: opts.dir,
      judgeProvider,
      timestamp: new Date().toISOString(),
    });
  } finally {
    await rm(configPath, { force: true }).catch(() => {});
    await rm(outPath, { force: true }).catch(() => {});
  }
}
