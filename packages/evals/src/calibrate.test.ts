// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/calibrate.test
 *
 * Bite tests for judge calibration (Phase 4F, ADR 0021): simple agreement and
 * Cohen's kappa between the LLM judge and a human on a labeled set, a verdict
 * that fails below the threshold, an unlabeled set reported as unlabeled rather
 * than as agreement, seeding judge verdicts from a real-model results file, and
 * the labels-file schema failing loudly on a malformed entry.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALIBRATION_MIN_AGREEMENT,
  CALIBRATION_MIN_KAPPA,
  CALIBRATION_MIN_LABELED,
  type CalibrationLabel,
  type CalibrationLabels,
  calibrate,
  cohensKappa,
  describeCalibration,
  parseCalibrationLabels,
  seedLabels,
} from "./calibrate.ts";
import { computeCost } from "./pricing.ts";
import type { EvalRunResult } from "./types.ts";

/** One labeled pair: the judge's verdict and the human's. */
function label(
  i: number,
  judge: boolean | null,
  human: "pass" | "fail" | null,
  over: Partial<CalibrationLabel> = {},
): CalibrationLabel {
  return {
    id: `case-${i}/validate:judge/1`,
    caseId: `case-${i}`,
    metric: "validate:judge",
    seededFrom: judge === null ? null : "nightly.json@2026-10-30T07:00:00.000Z",
    output: judge === null ? null : `{"draft_reply":"reply ${i}"}`,
    judge: judge === null ? null : { pass: judge, score: judge ? 1 : 0 },
    human,
    labeledBy: human === null ? null : "clarke",
    ...over,
  };
}

function file(labels: CalibrationLabel[]): CalibrationLabels {
  return {
    v: 1,
    suite: "packages/evals/promptfooconfig.yaml",
    instructions: "Set human to pass or fail.",
    labels,
  };
}

describe("cohensKappa", () => {
  test("matches a worked example", () => {
    // 20 pairs: 12 both pass, 4 both fail, 3 judge-pass/human-fail, 1 judge-fail/human-pass.
    // po = 16/20 = 0.8; pJ = 15/20, pH = 13/20; pe = 0.75*0.65 + 0.25*0.35 = 0.575.
    // kappa = (0.8 - 0.575) / (1 - 0.575) = 0.5294...
    const pairs = [
      ...Array.from({ length: 12 }, () => ({ judge: true, human: true })),
      ...Array.from({ length: 4 }, () => ({ judge: false, human: false })),
      ...Array.from({ length: 3 }, () => ({ judge: true, human: false })),
      { judge: false, human: true },
    ];
    expect(cohensKappa(pairs)).toBeCloseTo(0.5294, 3);
  });

  test("perfect agreement is 1, even when both raters say pass every time", () => {
    expect(cohensKappa([{ judge: true, human: true }])).toBe(1);
    expect(
      cohensKappa([
        { judge: true, human: true },
        { judge: false, human: false },
      ]),
    ).toBe(1);
  });

  test("a judge that always passes earns no credit for agreeing by chance", () => {
    const pairs = [
      ...Array.from({ length: 9 }, () => ({ judge: true, human: true })),
      { judge: true, human: false },
    ];
    // 90% simple agreement, but the judge never says fail: kappa is 0.
    expect(cohensKappa(pairs)).toBe(0);
  });
});

describe("calibrate", () => {
  test("an unlabeled set reports unlabeled, never agreement", () => {
    const report = calibrate(
      file(Array.from({ length: 20 }, (_, i) => label(i, null, null))),
      "labels.json",
    );
    expect(report.status).toBe("unlabeled");
    expect(report.labeled).toBe(0);
    expect(report.agreement).toBeNull();
    expect(report.kappa).toBeNull();
    expect(describeCalibration(report)).toContain("unlabeled");
    expect(describeCalibration(report)).not.toMatch(/agree(s|ment) [0-9]/);
  });

  test("human labels without a judge verdict (unseeded) do not count as pairs", () => {
    const report = calibrate(
      file(Array.from({ length: 12 }, (_, i) => label(i, null, "pass"))),
      "labels.json",
    );
    expect(report.status).toBe("unlabeled");
    expect(report.seeded).toBe(0);
  });

  test("fewer labeled pairs than the minimum is insufficient, not a pass", () => {
    const report = calibrate(
      file(Array.from({ length: CALIBRATION_MIN_LABELED - 1 }, (_, i) => label(i, true, "pass"))),
      "labels.json",
    );
    expect(report.status).toBe("insufficient");
    expect(report.agreement).toBe(1);
  });

  test("high agreement with real disagreement in both directions passes", () => {
    const labels = [
      ...Array.from({ length: 12 }, (_, i) => label(i, true, "pass")),
      ...Array.from({ length: 7 }, (_, i) => label(20 + i, false, "fail")),
      label(40, true, "fail"),
    ];
    const report = calibrate(file(labels), "labels.json");
    expect(report.labeled).toBe(20);
    expect(report.agreement).toBeCloseTo(0.95, 5);
    expect(report.kappa ?? 0).toBeGreaterThanOrEqual(CALIBRATION_MIN_KAPPA);
    expect(report.status).toBe("pass");
    expect(report.disagreements.map((d) => d.id)).toEqual(["case-40/validate:judge/1"]);
    expect(describeCalibration(report)).toContain("95%");
  });

  test("bite: agreement below the threshold fails", () => {
    const labels = [
      ...Array.from({ length: 10 }, (_, i) => label(i, true, "pass")),
      ...Array.from({ length: 5 }, (_, i) => label(20 + i, true, "fail")),
      ...Array.from({ length: 5 }, (_, i) => label(40 + i, false, "fail")),
    ];
    const report = calibrate(file(labels), "labels.json");
    expect(report.agreement).toBeCloseTo(0.75, 5);
    expect(report.agreement ?? 1).toBeLessThan(CALIBRATION_MIN_AGREEMENT);
    expect(report.status).toBe("fail");
    expect(report.confusion).toEqual({
      bothPass: 10,
      bothFail: 5,
      judgePassHumanFail: 5,
      judgeFailHumanPass: 0,
    });
  });

  test("bite: high simple agreement from a judge that always passes still fails on kappa", () => {
    const labels = [
      ...Array.from({ length: 18 }, (_, i) => label(i, true, "pass")),
      ...Array.from({ length: 2 }, (_, i) => label(20 + i, true, "fail")),
    ];
    const report = calibrate(file(labels), "labels.json");
    expect(report.agreement).toBeCloseTo(0.9, 5);
    expect(report.kappa).toBe(0);
    expect(report.status).toBe("fail");
  });
});

/** A real-model results file whose judge scored two cases. */
function nightly(judgeProvider = "bedrock"): EvalRunResult {
  const usage = { inputTokens: 10, outputTokens: 5 };
  const kase = (id: string, pass: boolean, score: number) => ({
    id,
    description: id,
    pass,
    score,
    trace: [
      {
        phase: "validate" as const,
        status: pass ? ("ok" as const) : ("fail" as const),
        checks: [{ metric: "validate:judge", pass, score, reason: `judge on ${id}` }],
      },
    ],
    output: `{"draft_reply":"${id}"}`,
    usage,
    stability: 1,
    repeats: 1,
  });
  return {
    provider: "bedrock",
    model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    judgeProvider,
    timestamp: "2026-10-30T07:00:00.000Z",
    source: "suite",
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      meanStability: 1,
      usage,
      cost: computeCost("bedrock", "haiku-4-5", usage, 1),
    },
    cases: [kase("billing-duplicate-charge", false, 0.65), kase("technical-login-loop", true, 1)],
  };
}

describe("seedLabels", () => {
  const unseeded = () =>
    file([
      label(0, null, null, {
        id: "billing-duplicate-charge/validate:judge/1",
        caseId: "billing-duplicate-charge",
      }),
      label(0, null, null, {
        id: "billing-duplicate-charge/validate:judge/2",
        caseId: "billing-duplicate-charge",
      }),
      label(0, null, null, {
        id: "technical-login-loop/validate:judge/1",
        caseId: "technical-login-loop",
      }),
    ]);

  test("fills the output and the judge verdict from a real-model run, never the human label", () => {
    const { labels, seeded } = seedLabels(unseeded(), nightly(), "nightly.json");
    expect(seeded).toBe(2);
    const first = labels.labels[0];
    expect(first?.judge).toEqual({ pass: false, score: 0.65, reason: "judge on billing-duplicate-charge" });
    expect(first?.output).toBe('{"draft_reply":"billing-duplicate-charge"}');
    expect(first?.seededFrom).toBe("nightly.json@2026-10-30T07:00:00.000Z");
    expect(first?.human).toBeNull();
    // One run seeds one slot per case and metric; the second slot waits for another run.
    expect(labels.labels[1]?.judge).toBeNull();
    expect(labels.labels[2]?.judge?.pass).toBe(true);
  });

  test("seeding twice from the same run fills nothing new", () => {
    const once = seedLabels(unseeded(), nightly(), "nightly.json").labels;
    expect(seedLabels(once, nightly(), "nightly.json").seeded).toBe(0);
  });

  test("refuses a stub-judged run: calibrating the stub judge measures nothing", () => {
    expect(() => seedLabels(unseeded(), nightly("stub"), "stub.json")).toThrow(/stub/);
  });
});

describe("labels file schema", () => {
  test("the committed labels file parses, holds about 20 entries, and is honestly unlabeled", () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "calibration", "labels.json"), "utf8"),
    ) as unknown;
    const labels = parseCalibrationLabels(raw);
    expect(labels.labels.length).toBeGreaterThanOrEqual(18);
    expect(labels.labels.length).toBeLessThanOrEqual(24);
    for (const l of labels.labels) {
      expect(l.metric).toMatch(/judge/);
      // Nothing is fabricated: no human label until Clarke writes one.
      expect(l.human).toBeNull();
    }
    expect(calibrate(labels, "labels.json").status).toBe("unlabeled");
  });

  test("a malformed entry fails loudly", () => {
    const bad = file([label(0, true, "pass")]) as unknown as { labels: Record<string, unknown>[] };
    const entry = bad.labels[0];
    if (entry) entry.human = "maybe";
    expect(() => parseCalibrationLabels(bad)).toThrow();
    expect(() => parseCalibrationLabels({ ...file([label(0, true, "pass")]), extra: 1 })).toThrow();
  });

  test("duplicate label ids fail loudly", () => {
    expect(() => parseCalibrationLabels(file([label(0, true, "pass"), label(0, true, "pass")]))).toThrow(
      /duplicate/,
    );
  });
});
