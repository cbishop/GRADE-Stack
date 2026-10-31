// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/calibrate
 *
 * Judge calibration (Phase 4F, ADR 0021): how often the LLM judge agrees with a
 * human on a hand-labeled set, as simple agreement and Cohen's kappa. Kappa is
 * there because simple agreement flatters a judge that passes nearly
 * everything: if the human also passes nearly everything, the two agree by
 * chance. The threshold is fixed in code (agreement at least 80% and kappa at
 * least 0.6 over at least 10 labeled pairs), so a labels file cannot lower its
 * own bar. A set nobody has labeled is reported as `unlabeled`; agreement is
 * never computed from a label nobody wrote.
 *
 * The labels file (`packages/evals/calibration/labels.json`) holds one entry
 * per judged assertion: the case id, the judge metric, the output the judge
 * scored and its verdict (seeded from a real-model results file with
 * `eval calibrate --seed`), and the human label (`pass`, `fail`, or `null`
 * until someone labels it). Pure: callers do the I/O.
 */

import { z } from "zod";
import type { EvalRunResult } from "./types.ts";

/** Minimum simple agreement between judge and human. */
export const CALIBRATION_MIN_AGREEMENT = 0.8;
/** Minimum Cohen's kappa (0.6 is the conventional floor of "substantial"). */
export const CALIBRATION_MIN_KAPPA = 0.6;
/** Fewer labeled pairs than this cannot calibrate anything. */
export const CALIBRATION_MIN_LABELED = 10;

/** The committed labels file, relative to the repo root. */
export const DEFAULT_LABELS_FILE = "packages/evals/calibration/labels.json";

/** One judged assertion: what the judge said, and what a human said. */
export const CalibrationLabelSchema = z.strictObject({
  /** Unique label id: `<caseId>/<metric>/<slot>`. */
  id: z.string().min(1),
  caseId: z.string().min(1),
  /** The judge metric, e.g. `validate:judge`. */
  metric: z.string().min(1),
  /** `<results file>@<run timestamp>` the output and verdict came from; null until seeded. */
  seededFrom: z.string().nullable(),
  /** The agent output the judge scored; null until seeded. */
  output: z.string().nullable(),
  /** The judge's verdict on that output; null until seeded. */
  judge: z
    .strictObject({ pass: z.boolean(), score: z.number(), reason: z.string().optional() })
    .nullable(),
  /** The human's label on the same output; null means unlabeled. */
  human: z.enum(["pass", "fail"]).nullable(),
  /** Who wrote the human label. */
  labeledBy: z.string().nullable(),
  note: z.string().optional(),
});

/** One label entry. */
export type CalibrationLabel = z.infer<typeof CalibrationLabelSchema>;

/** The labels file. */
export const CalibrationLabelsSchema = z
  .strictObject({
    v: z.literal(1),
    /** The suite definition the labels belong to. */
    suite: z.string().min(1),
    /** How to label, for the person doing it. */
    instructions: z.string(),
    labels: z.array(CalibrationLabelSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const [i, l] of f.labels.entries()) {
      if (seen.has(l.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["labels", i, "id"],
          message: `duplicate label id ${l.id}`,
        });
      }
      seen.add(l.id);
    }
  });

/** A validated labels file. */
export type CalibrationLabels = z.infer<typeof CalibrationLabelsSchema>;

/** Validate a labels file; a malformed entry fails loudly. */
export function parseCalibrationLabels(raw: unknown): CalibrationLabels {
  return CalibrationLabelsSchema.parse(raw);
}

/**
 * `unlabeled`: no entry has both a judge verdict and a human label.
 * `insufficient`: fewer labeled pairs than the minimum.
 * `pass` / `fail`: at or above, or below, the threshold.
 */
export type CalibrationStatus = "unlabeled" | "insufficient" | "pass" | "fail";

/** The calibration result for one labels file. */
export interface CalibrationReport {
  labelsFile: string;
  /** Label entries in the file. */
  total: number;
  /** Entries with a judge verdict. */
  seeded: number;
  /** Entries with both a judge verdict and a human label (the pairs). */
  labeled: number;
  /** Pairs where the judge and the human agree. */
  agree: number;
  /** Simple agreement over the pairs; null when there are none. */
  agreement: number | null;
  /** Cohen's kappa over the pairs; null when there are none. */
  kappa: number | null;
  confusion: {
    bothPass: number;
    bothFail: number;
    judgePassHumanFail: number;
    judgeFailHumanPass: number;
  };
  thresholds: { minAgreement: number; minKappa: number; minLabeled: number };
  status: CalibrationStatus;
  /** Pairs where the judge and the human disagree. */
  disagreements: { id: string; judge: boolean; human: "pass" | "fail" }[];
}

/**
 * Cohen's kappa for two binary raters: (observed − chance) / (1 − chance). When
 * chance agreement is total (both raters always gave the same single answer)
 * the raters agree perfectly and kappa is 1.
 */
export function cohensKappa(pairs: { judge: boolean; human: boolean }[]): number {
  const n = pairs.length;
  if (n === 0) return 0;
  const po = pairs.filter((p) => p.judge === p.human).length / n;
  const pj = pairs.filter((p) => p.judge).length / n;
  const ph = pairs.filter((p) => p.human).length / n;
  const pe = pj * ph + (1 - pj) * (1 - ph);
  if (pe >= 1) return po >= 1 ? 1 : 0;
  const k = (po - pe) / (1 - pe);
  // Snap float noise so a judge that never says fail reads exactly 0.
  return Math.abs(k) < 1e-12 ? 0 : k;
}

/** Judge a calibration from its numbers against the fixed thresholds. */
export function calibrationStatus(
  labeled: number,
  agreement: number | null,
  kappa: number | null,
): CalibrationStatus {
  if (labeled === 0 || agreement === null || kappa === null) return "unlabeled";
  if (labeled < CALIBRATION_MIN_LABELED) return "insufficient";
  return agreement >= CALIBRATION_MIN_AGREEMENT && kappa >= CALIBRATION_MIN_KAPPA ? "pass" : "fail";
}

/** Compute judge-versus-human agreement for a labels file. */
export function calibrate(labels: CalibrationLabels, labelsFile: string): CalibrationReport {
  const pairs = labels.labels.flatMap((l) =>
    l.judge !== null && l.human !== null
      ? [{ id: l.id, judge: l.judge.pass, human: l.human, humanPass: l.human === "pass" }]
      : [],
  );
  const n = pairs.length;
  const agree = pairs.filter((p) => p.judge === p.humanPass).length;
  const agreement = n === 0 ? null : agree / n;
  const kappa =
    n === 0 ? null : cohensKappa(pairs.map((p) => ({ judge: p.judge, human: p.humanPass })));
  return {
    labelsFile,
    total: labels.labels.length,
    seeded: labels.labels.filter((l) => l.judge !== null).length,
    labeled: n,
    agree,
    agreement,
    kappa,
    confusion: {
      bothPass: pairs.filter((p) => p.judge && p.humanPass).length,
      bothFail: pairs.filter((p) => !p.judge && !p.humanPass).length,
      judgePassHumanFail: pairs.filter((p) => p.judge && !p.humanPass).length,
      judgeFailHumanPass: pairs.filter((p) => !p.judge && p.humanPass).length,
    },
    thresholds: {
      minAgreement: CALIBRATION_MIN_AGREEMENT,
      minKappa: CALIBRATION_MIN_KAPPA,
      minLabeled: CALIBRATION_MIN_LABELED,
    },
    status: calibrationStatus(n, agreement, kappa),
    disagreements: pairs
      .filter((p) => p.judge !== p.humanPass)
      .map((p) => ({ id: p.id, judge: p.judge, human: p.human })),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The calibration in plain language, one paragraph a reviewer can read. */
export function describeCalibration(r: CalibrationReport): string {
  const bar = `the bar is agreement of at least ${pct(r.thresholds.minAgreement)} and kappa of at least ${r.thresholds.minKappa} over at least ${r.thresholds.minLabeled} labeled pairs`;
  if (r.status === "unlabeled") {
    return `Judge calibration: unlabeled. ${r.labelsFile} holds ${r.total} judged assertion(s), ${r.seeded} seeded with a judge verdict, none labeled by a person, so no agreement is claimed. Label them (see the README beside the file); ${bar}.`;
  }
  const head = `Judge calibration: the judge agrees with the human on ${r.agree} of ${r.labeled} labeled pair(s) (${pct(r.agreement ?? 0)}), Cohen's kappa ${(r.kappa ?? 0).toFixed(2)}`;
  const split = `${r.confusion.judgePassHumanFail} pass(es) the human failed, ${r.confusion.judgeFailHumanPass} fail(s) the human passed`;
  const verdict =
    r.status === "pass"
      ? `At or above the threshold: ${bar}.`
      : r.status === "insufficient"
        ? `Not enough labels to trust yet: ${r.labeled} of the ${r.thresholds.minLabeled} needed; ${bar}.`
        : `Below the threshold: ${bar}. Do not trust the judge's pass rate until it is fixed.`;
  return `${head}; ${split}. ${verdict}`;
}

/**
 * Seed unseeded label slots from a real-model results file: for each case and
 * judge metric in the run, fill the first slot with no judge verdict with the
 * case's output and the judge's verdict. One run seeds at most one slot per
 * case and metric, and a run already used is not used again. Human labels are
 * never touched. A stub-judged run is refused: calibrating the stub judge
 * measures nothing.
 */
export function seedLabels(
  labels: CalibrationLabels,
  result: EvalRunResult,
  resultsFile: string,
): { labels: CalibrationLabels; seeded: number } {
  if (result.judgeProvider === "stub") {
    throw new Error(
      `${resultsFile} was judged by the stub provider; seed from a real-model run (the nightly results artifact), not the stub`,
    );
  }
  const from = `${resultsFile}@${result.timestamp}`;
  const next = labels.labels.map((l) => ({ ...l }));
  let seeded = 0;
  for (const kase of result.cases) {
    for (const check of kase.trace.flatMap((s) => s.checks)) {
      const slots = next.filter((l) => l.caseId === kase.id && l.metric === check.metric);
      if (slots.some((l) => l.seededFrom?.endsWith(`@${result.timestamp}`))) continue;
      const slot = slots.find((l) => l.judge === null);
      if (!slot) continue;
      slot.seededFrom = from;
      slot.output = kase.output;
      slot.judge = {
        pass: check.pass,
        score: check.score,
        ...(check.reason !== undefined ? { reason: check.reason } : {}),
      };
      seeded++;
    }
  }
  return { labels: parseCalibrationLabels({ ...labels, labels: next }), seeded };
}
