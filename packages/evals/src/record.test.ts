// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/record.test
 *
 * Bite tests for the eval record (Phase 4F, ADR 0021): built from results
 * files, it names the suite definition hash, the committed baselines, the
 * last real-model run, the judge calibration and the last production re-score;
 * it renders as a deployer-fillable Markdown template whose computed block is
 * machine-readable, regenerating keeps what the deployer filled in, and a
 * missing or malformed computed block fails loudly.
 */

import { describe, expect, test } from "bun:test";
import { calibrate } from "./calibrate.ts";
import { computeCost } from "./pricing.ts";
import {
  buildEvalRecord,
  describeEvalRecord,
  EVAL_RECORD_BEGIN,
  EVAL_RECORD_END,
  parseEvalRecord,
  renderEvalRecord,
  suiteDefinitionHash,
} from "./record.ts";
import type { EvalRunResult } from "./types.ts";

function result(over: Partial<EvalRunResult> & { passed?: number; total?: number } = {}): EvalRunResult {
  const total = over.total ?? 12;
  const passed = over.passed ?? 11;
  const provider = over.provider ?? "bedrock";
  const model = over.model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  const usage = { inputTokens: 1000, outputTokens: 300 };
  const { passed: _p, total: _t, ...rest } = over;
  return {
    provider,
    model,
    judgeProvider: provider,
    timestamp: "2026-10-30T07:00:00.000Z",
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: passed / total,
      meanStability: 1,
      usage,
      cost: computeCost(provider, model, usage, passed),
    },
    cases: Array.from({ length: total }, (_, i) => ({
      id: i === 0 ? "billing-duplicate-charge" : `case-${i}`,
      description: `case-${i}`,
      pass: i >= total - passed,
      score: 1,
      trace: [],
      output: "{}",
      usage: { inputTokens: 0, outputTokens: 0 },
      stability: 1,
      repeats: 1,
    })),
    ...rest,
  };
}

const SUITE = { path: "packages/evals/promptfooconfig.yaml", text: "tests:\n  - description: a\n" };
const unlabeled = calibrate(
  {
    v: 1,
    suite: SUITE.path,
    instructions: "x",
    labels: [
      {
        id: "a/validate:judge/1",
        caseId: "a",
        metric: "validate:judge",
        seededFrom: null,
        output: null,
        judge: null,
        human: null,
        labeledBy: null,
      },
    ],
  },
  "packages/evals/calibration/labels.json",
);

function record() {
  return buildEvalRecord({
    generatedAt: "2026-10-30T15:00:00.000Z",
    suite: { ...SUITE, caseCount: 12 },
    baselines: [
      { file: "packages/evals/baseline.stub.json", result: result({ provider: "stub", model: "stub-deterministic-v1", passed: 12 }) },
    ],
    results: [
      { file: "runs/old.json", result: result({ timestamp: "2026-10-01T07:00:00.000Z", passed: 12 }) },
      { file: "runs/new.json", result: result({ timestamp: "2026-10-30T07:00:00.000Z" }) },
      { file: "runs/stub.json", result: result({ provider: "stub", timestamp: "2026-10-30T09:00:00.000Z" }) },
      {
        file: "runs/rescore.json",
        result: result({
          provider: "traces",
          model: "captured",
          judgeProvider: "bedrock",
          source: "traces",
          timestamp: "2026-10-30T08:00:00.000Z",
          total: 3,
          passed: 2,
          traces: {
            dir: "gateway-captures",
            captures: 4,
            rescored: 3,
            skipped: [{ file: "x.json", requestId: "x", reason: "no output" }],
            firstCapturedAt: "2026-10-29T10:00:00.000Z",
            lastCapturedAt: "2026-10-29T18:00:00.000Z",
          },
        }),
      },
    ],
    calibration: unlabeled,
  });
}

describe("suiteDefinitionHash", () => {
  test("is the SHA-256 of the suite definition, so any edit to the suite changes it", () => {
    const a = suiteDefinitionHash("tests: []\n");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(suiteDefinitionHash("tests: []\n")).toBe(a);
    expect(suiteDefinitionHash("tests: [x]\n")).not.toBe(a);
  });
});

describe("buildEvalRecord", () => {
  test("names the suite hash, baselines, latest real-model run, calibration and latest re-score", () => {
    const r = record();
    expect(r.suite.definitionHash).toBe(suiteDefinitionHash(SUITE.text));
    expect(r.suite.caseCount).toBe(12);
    expect(r.baselines).toEqual([
      expect.objectContaining({ file: "packages/evals/baseline.stub.json", provider: "stub", passed: 12, total: 12 }),
    ]);
    // The newest non-stub suite run; the stub run and the re-score are not real-model runs.
    expect(r.lastRealModelRun).toMatchObject({
      file: "runs/new.json",
      timestamp: "2026-10-30T07:00:00.000Z",
      provider: "bedrock",
      passed: 11,
      total: 12,
      failedCases: ["billing-duplicate-charge"],
    });
    expect(r.lastRescore).toMatchObject({
      file: "runs/rescore.json",
      timestamp: "2026-10-30T08:00:00.000Z",
      captureDir: "gateway-captures",
      passed: 2,
      total: 3,
      skipped: 1,
    });
    expect(r.calibration.status).toBe("unlabeled");
  });

  test("with no real-model run or re-score, says so instead of inventing one", () => {
    const r = buildEvalRecord({
      generatedAt: "2026-10-30T15:00:00.000Z",
      suite: { ...SUITE, caseCount: 12 },
      baselines: [],
      results: [{ file: "stub.json", result: result({ provider: "stub" }) }],
      calibration: unlabeled,
    });
    expect(r.lastRealModelRun).toBeNull();
    expect(r.lastRescore).toBeNull();
    expect(describeEvalRecord(r).join("\n")).toContain("No real-model run recorded");
  });
});

describe("renderEvalRecord and parseEvalRecord", () => {
  test("the template carries deployer fields and a machine-readable computed block that round-trips", () => {
    const md = renderEvalRecord(record());
    expect(md).toContain(EVAL_RECORD_BEGIN);
    expect(md).toContain(EVAL_RECORD_END);
    expect(md).toContain("<fill in");
    expect(md).toContain(suiteDefinitionHash(SUITE.text));
    expect(parseEvalRecord(md)).toEqual(record());
  });

  test("regenerating keeps the deployer's filled-in text and replaces only the computed block", () => {
    const first = renderEvalRecord(record()).replace(
      "**Record owner:** <fill in",
      "**Record owner:** Clarke Bishop <!-- was: <fill in",
    );
    const next = { ...record(), generatedAt: "2026-11-02T15:00:00.000Z" };
    const second = renderEvalRecord(next, first);
    expect(second).toContain("**Record owner:** Clarke Bishop");
    expect(parseEvalRecord(second).generatedAt).toBe("2026-11-02T15:00:00.000Z");
  });

  test("a record without the computed block, or with a malformed one, fails loudly", () => {
    expect(() => parseEvalRecord("# Eval record\nnothing computed here\n")).toThrow(/computed block/);
    const broken = renderEvalRecord(record()).replace('"v": 1', '"v": 2');
    expect(() => parseEvalRecord(broken)).toThrow();
  });

  test("the plain-language readback states each computed field in a sentence", () => {
    const lines = describeEvalRecord(record()).join("\n");
    expect(lines).toContain("Suite: 12 cases");
    expect(lines).toContain("Last real-model run: 2026-10-30");
    expect(lines).toContain("11 of 12 passed");
    expect(lines).toContain("billing-duplicate-charge");
    expect(lines).toContain("Judge calibration: unlabeled");
    expect(lines).toContain("Last production re-score: 2026-10-30");
  });
});
