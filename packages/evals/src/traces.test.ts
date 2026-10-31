// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/traces.test
 *
 * Bite tests for post-deployment re-scoring (Phase 4F, ADR 0021): the 4B
 * capture directory is read through the capture schema, each captured triage
 * answer becomes a replay case carrying its request id, non-triage and blocked
 * requests are skipped with a reason, a malformed capture fails loudly, and the
 * re-scored result is stamped `source: "traces"` with request ids preserved.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaptureRecord, writeCapture } from "@grade-stack/gateway";
import type { PromptfooRow } from "./run.ts";
import { loadTraceCases, stampTraceResult, traceTests } from "./traces.ts";

let dir: string;

function capture(requestId: string, over: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    v: 1,
    requestId,
    callerId: "triage",
    at: "2026-10-30T12:00:00.000Z",
    target: "stub",
    request: {
      system: "You are a customer-support triage assistant.",
      messages: [
        {
          role: "user",
          content:
            "Triage the following support email.\n\nFrom: a@b.example\nSubject: x\n\nCharged twice.",
        },
      ],
    },
    output: '{"category":"billing"}',
    ...over,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "grade-stack-traces-"));
  await writeCapture(dir, capture("req-a"));
  await writeCapture(dir, capture("req-a", { output: '{"category":"technical"}' }));
  await writeCapture(dir, capture("req-b", { at: "2026-10-30T12:05:00.000Z" }));
  await writeCapture(dir, capture("req-blocked", { output: null }));
  await writeCapture(
    dir,
    capture("req-select", {
      request: { messages: [{ role: "user", content: "Pick a tool for this task." }] },
    }),
  );
  writeFileSync(join(dir, "notes.txt"), "not a capture");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loadTraceCases", () => {
  test("every captured triage answer becomes a case keyed by its request id", async () => {
    const { cases } = await loadTraceCases(dir);
    expect(cases.map((c) => c.id)).toEqual(["req-a", "req-a.2", "req-b"]);
    expect(cases.map((c) => c.requestId)).toEqual(["req-a", "req-a", "req-b"]);
    expect(cases[0]?.output).toBe('{"category":"billing"}');
    expect(cases[1]?.output).toBe('{"category":"technical"}');
    expect(cases[0]?.prompt).toContain("Charged twice.");
    expect(cases[0]?.callerId).toBe("triage");
  });

  test("blocked and non-triage requests are skipped with a reason, not scored", async () => {
    const { skipped } = await loadTraceCases(dir);
    expect(skipped.map((s) => s.requestId).sort()).toEqual(["req-blocked", "req-select"]);
    expect(skipped.find((s) => s.requestId === "req-blocked")?.reason).toContain("no output");
    expect(skipped.find((s) => s.requestId === "req-select")?.reason).toContain(
      "not a triage request",
    );
  });

  test("a malformed capture fails loudly, naming the file", async () => {
    const bad = mkdtempSync(join(tmpdir(), "grade-stack-traces-bad-"));
    try {
      writeFileSync(join(bad, "req-x.json"), JSON.stringify({ v: 1, requestId: "req-x" }));
      await expect(loadTraceCases(bad)).rejects.toThrow(/req-x\.json/);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });

  test("a missing directory fails loudly", async () => {
    await expect(loadTraceCases(join(dir, "nope"))).rejects.toThrow();
  });
});

describe("traceTests", () => {
  test("each case replays its captured output through the suite's default assertions", async () => {
    const { cases } = await loadTraceCases(dir);
    const tests = traceTests(cases);
    expect(tests.length).toBe(3);
    expect(tests[0]).toMatchObject({
      description: "req-a",
      vars: {
        captured_output: '{"category":"billing"}',
        request_id: "req-a",
      },
    });
    expect(tests[0]?.vars.email_body).toContain("Charged twice.");
    // No per-case expected labels: production traffic has none.
    expect("assert" in (tests[0] ?? {})).toBe(false);
  });
});

describe("stampTraceResult", () => {
  test("stamps source traces and preserves the request id on every case", async () => {
    const loaded = await loadTraceCases(dir);
    const row = (id: string, success: boolean): PromptfooRow => ({
      success,
      score: success ? 1 : 0,
      testCase: { description: id },
      response: { output: "{}" },
      gradingResult: {
        componentResults: [
          { pass: success, score: success ? 1 : 0, assertion: { metric: "validate:judge" } },
        ],
      },
    });
    const result = stampTraceResult(
      [row("req-a", true), row("req-a.2", false), row("req-b", true)],
      loaded,
      { dir, judgeProvider: "stub", timestamp: "2026-10-30T13:00:00.000Z" },
    );
    expect(result.source).toBe("traces");
    expect(result.cases.map((c) => [c.id, c.requestId])).toEqual([
      ["req-a", "req-a"],
      ["req-a.2", "req-a"],
      ["req-b", "req-b"],
    ]);
    expect(result.summary).toMatchObject({ total: 3, passed: 2, failed: 1 });
    expect(result.traces).toMatchObject({ dir, captures: 5, rescored: 3 });
    expect(result.traces?.skipped.length).toBe(2);
    expect(result.traces?.firstCapturedAt).toBe("2026-10-30T12:00:00.000Z");
    expect(result.traces?.lastCapturedAt).toBe("2026-10-30T12:05:00.000Z");
    // Re-scoring replays outputs: no agent tokens are spent.
    expect(result.summary.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
