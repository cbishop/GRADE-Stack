// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/record
 *
 * The eval record (Phase 4F, ADR 0021): one Markdown file, `docs/eval-record.md`,
 * that says whether the suite can be trusted today. Half of it is a template the
 * deployer fills in (owner, cadence, who labels, how incidents become cases);
 * the other half is computed by `reliability eval record` from results files:
 * the suite definition hash, the committed baselines, the last real-model run,
 * judge-versus-human calibration and the last production re-score. The
 * computed half sits between two HTML-comment markers as plain sentences plus a
 * JSON block validated by {@link EvalRecordSchema}, which is what the
 * scorecard's E letter reads. Regenerating replaces only that block, so what
 * the deployer wrote survives. Pure: callers do the I/O.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { type CalibrationReport, describeCalibration } from "./calibrate.ts";
import type { EvalRunResult } from "./types.ts";

/** Where the eval record lives, relative to the repo root. */
export const DEFAULT_EVAL_RECORD = "docs/eval-record.md";
/** Opens the computed block. */
export const EVAL_RECORD_BEGIN = "<!-- eval-record:computed:begin -->";
/** Closes the computed block. */
export const EVAL_RECORD_END = "<!-- eval-record:computed:end -->";

/** A real-model run older than this many days is stale (E: real-model freshness). */
export const REAL_MODEL_MAX_AGE_DAYS = 30;
/** A production re-score older than this many days is stale (E: post-deployment). */
export const RESCORE_MAX_AGE_DAYS = 30;

const iso = z.iso.datetime({ offset: true });
const rate = z.number().min(0).max(1);
const count = z.number().int().min(0);

const CalibrationReportSchema = z.strictObject({
  labelsFile: z.string(),
  total: count,
  seeded: count,
  labeled: count,
  agree: count,
  agreement: rate.nullable(),
  kappa: z.number().min(-1).max(1).nullable(),
  confusion: z.strictObject({
    bothPass: count,
    bothFail: count,
    judgePassHumanFail: count,
    judgeFailHumanPass: count,
  }),
  thresholds: z.strictObject({ minAgreement: rate, minKappa: z.number(), minLabeled: count }),
  status: z.enum(["unlabeled", "insufficient", "pass", "fail"]),
  disagreements: z.array(
    z.strictObject({ id: z.string(), judge: z.boolean(), human: z.enum(["pass", "fail"]) }),
  ),
});

/** The computed half of the eval record. */
export const EvalRecordSchema = z.strictObject({
  v: z.literal(1),
  generatedAt: iso,
  suite: z.strictObject({
    path: z.string().min(1),
    /** SHA-256 of the suite definition file: any edit to the suite changes it. */
    definitionHash: z.string().regex(/^[0-9a-f]{64}$/),
    caseCount: count,
  }),
  baselines: z.array(
    z.strictObject({
      file: z.string(),
      provider: z.string(),
      model: z.string(),
      passed: count,
      total: count,
      passRate: rate,
      timestamp: z.string().nullable(),
      gitSha: z.string().nullable(),
    }),
  ),
  /** The newest suite run on a real (non-stub) model in the results given. */
  lastRealModelRun: z
    .strictObject({
      file: z.string(),
      timestamp: iso,
      provider: z.string(),
      model: z.string(),
      judgeProvider: z.string(),
      passed: count,
      total: count,
      passRate: rate,
      totalUsd: z.number().min(0),
      failedCases: z.array(z.string()),
    })
    .nullable(),
  calibration: CalibrationReportSchema,
  /** The newest `eval run --from-traces` re-score in the results given. */
  lastRescore: z
    .strictObject({
      file: z.string(),
      timestamp: iso,
      captureDir: z.string(),
      judgeProvider: z.string(),
      passed: count,
      total: count,
      passRate: rate,
      skipped: count,
      failedRequestIds: z.array(z.string()),
      firstCapturedAt: z.string().nullable(),
      lastCapturedAt: z.string().nullable(),
    })
    .nullable(),
});

/** A validated eval record (the computed half). */
export type EvalRecord = z.infer<typeof EvalRecordSchema>;

/** SHA-256 of the suite definition text. */
export function suiteDefinitionHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A results file and its parsed contents. */
export interface RecordInput {
  file: string;
  result: EvalRunResult;
}

/** Inputs to {@link buildEvalRecord}. */
export interface BuildEvalRecordInput {
  generatedAt: string;
  suite: { path: string; text: string; caseCount: number };
  /** The committed baselines (`packages/evals/baseline*.json`). */
  baselines: RecordInput[];
  /** Results files: real-model runs, stub runs and trace re-scores, in any order. */
  results: RecordInput[];
  calibration: CalibrationReport;
}

const newest = (xs: RecordInput[]): RecordInput | undefined =>
  [...xs].sort((a, b) => Date.parse(b.result.timestamp) - Date.parse(a.result.timestamp))[0];

/**
 * Build the computed half of the eval record. The last real-model run is the
 * newest suite run whose provider is not the stub; the last re-score is the
 * newest result with `source: "traces"`. Neither is invented when absent.
 */
export function buildEvalRecord(input: BuildEvalRecordInput): EvalRecord {
  const real = newest(
    input.results.filter(
      (r) => (r.result.source ?? "suite") === "suite" && r.result.provider !== "stub",
    ),
  );
  const rescore = newest(input.results.filter((r) => r.result.source === "traces"));
  return EvalRecordSchema.parse({
    v: 1,
    generatedAt: input.generatedAt,
    suite: {
      path: input.suite.path,
      definitionHash: suiteDefinitionHash(input.suite.text),
      caseCount: input.suite.caseCount,
    },
    baselines: input.baselines.map(({ file, result }) => ({
      file,
      provider: result.provider,
      model: result.model,
      passed: result.summary.passed,
      total: result.summary.total,
      passRate: result.summary.passRate,
      timestamp: result.timestamp ?? null,
      gitSha: result.release?.gitSha ?? null,
    })),
    lastRealModelRun: real
      ? {
          file: real.file,
          timestamp: real.result.timestamp,
          provider: real.result.provider,
          model: real.result.model,
          judgeProvider: real.result.judgeProvider,
          passed: real.result.summary.passed,
          total: real.result.summary.total,
          passRate: real.result.summary.passRate,
          totalUsd: real.result.summary.cost.totalUsd,
          failedCases: real.result.cases.filter((c) => !c.pass).map((c) => c.id),
        }
      : null,
    calibration: input.calibration,
    lastRescore: rescore
      ? {
          file: rescore.file,
          timestamp: rescore.result.timestamp,
          captureDir: rescore.result.traces?.dir ?? "(unknown)",
          judgeProvider: rescore.result.judgeProvider,
          passed: rescore.result.summary.passed,
          total: rescore.result.summary.total,
          passRate: rescore.result.summary.passRate,
          skipped: rescore.result.traces?.skipped.length ?? 0,
          failedRequestIds: rescore.result.cases
            .filter((c) => !c.pass)
            .map((c) => c.requestId ?? c.id),
          firstCapturedAt: rescore.result.traces?.firstCapturedAt ?? null,
          lastCapturedAt: rescore.result.traces?.lastCapturedAt ?? null,
        }
      : null,
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (t: string) => t.slice(0, 10);

/** The computed fields in plain language, one sentence each. */
export function describeEvalRecord(r: EvalRecord): string[] {
  const real = r.lastRealModelRun;
  const re = r.lastRescore;
  return [
    `Suite: ${r.suite.caseCount} cases in ${r.suite.path}, definition hash ${r.suite.definitionHash.slice(0, 12)} (any edit to the suite changes it).`,
    r.baselines.length === 0
      ? "Committed baselines: none."
      : `Committed baselines: ${r.baselines.map((b) => `${b.file} (${b.provider}/${b.model}, ${b.passed} of ${b.total} passed)`).join("; ")}.`,
    real
      ? `Last real-model run: ${day(real.timestamp)} on ${real.provider} (${real.model}), judged by ${real.judgeProvider}: ${real.passed} of ${real.total} passed (${pct(real.passRate)}), $${real.totalUsd.toFixed(4)}${real.failedCases.length > 0 ? `; failed: ${real.failedCases.join(", ")}` : ""}. Source: ${real.file}.`
      : "No real-model run recorded in the results given: the suite's pass rate is measured only on the stub.",
    describeCalibration(r.calibration),
    re
      ? `Last production re-score: ${day(re.timestamp)}, ${re.passed} of ${re.total} captured run(s) from ${re.captureDir} passed (${pct(re.passRate)})${re.firstCapturedAt ? `, captured ${day(re.firstCapturedAt)} to ${day(re.lastCapturedAt ?? re.firstCapturedAt)}` : ""}${re.skipped > 0 ? `, ${re.skipped} capture(s) skipped` : ""}${re.failedRequestIds.length > 0 ? `; failing request ids: ${re.failedRequestIds.join(", ")}` : ""}. Source: ${re.file}.`
      : "No production re-score recorded: run `reliability eval run --from-traces <capture-dir> --out <file>` and pass the file to `eval record`.",
  ];
}

/** The computed block: sentences for a reader, JSON for the scorecard. */
function computedBlock(r: EvalRecord): string {
  return [
    EVAL_RECORD_BEGIN,
    "",
    `Generated ${r.generatedAt} by \`reliability eval record\`. Do not edit by hand; regenerate.`,
    "",
    ...describeEvalRecord(r).map((l) => `- ${l.replaceAll("$", "\\$")}`),
    "",
    "```json",
    JSON.stringify(r, null, 2),
    "```",
    "",
    EVAL_RECORD_END,
  ].join("\n");
}

/** The deployer-fillable template around a fresh computed block. */
function template(block: string): string {
  return `# Eval record

> Generated by \`reliability eval record\` (Phase 4F, ADR 0021). The fields marked
> "fill in" are the deployer's; regenerating keeps them and replaces only the
> computed block at the end. The scorecard's E letter reads that block
> (\`reliability scorecard --eval-record docs/eval-record.md\`).

## Deployer fields

- **Record owner:** <fill in: the person accountable for the suite and this record>
- **System under evaluation:** <fill in: agent, task, deployment, and the model it runs on in production>
- **Real-model cadence:** <fill in: how often the full suite runs on the production model, and what triggers an extra run (a model, prompt or tool change)>
- **Calibration labeler:** <fill in: who hand-labels the judge calibration set, and how often it is refreshed>
- **Production re-score cadence and sample:** <fill in: how often captured production runs are re-scored, how they are sampled, and who reads the failures>
- **Incident-to-case workflow:** <fill in: how a production failure becomes a new suite case>
- **Accepted residuals:** <fill in: what this suite does not measure, and who accepted that>

## Observations

<fill in: dated notes on what the real-model runs, the calibration and the re-scores showed, and what was done about it>

## Computed fields

${block}
`;
}

/**
 * Render the eval record. Given the existing file, only the computed block is
 * replaced and everything the deployer wrote is kept; without one (or with a
 * file that has no block) the full template is written.
 */
export function renderEvalRecord(record: EvalRecord, existing?: string): string {
  const block = computedBlock(EvalRecordSchema.parse(record));
  if (existing) {
    const start = existing.indexOf(EVAL_RECORD_BEGIN);
    const end = existing.indexOf(EVAL_RECORD_END);
    if (start !== -1 && end > start) {
      return existing.slice(0, start) + block + existing.slice(end + EVAL_RECORD_END.length);
    }
  }
  return template(block);
}

/**
 * Read the computed half back out of an eval record. A file with no computed
 * block, or one whose JSON is malformed or fails the schema, fails loudly:
 * the scorecard never grades from a partial record.
 */
export function parseEvalRecord(markdown: string): EvalRecord {
  const start = markdown.indexOf(EVAL_RECORD_BEGIN);
  const end = markdown.indexOf(EVAL_RECORD_END);
  if (start === -1 || end <= start) {
    throw new Error(
      "the eval record has no computed block; regenerate it with `reliability eval record`",
    );
  }
  const json = /```json\n([\s\S]*?)\n```/.exec(markdown.slice(start, end))?.[1];
  if (json === undefined) {
    throw new Error("the eval record's computed block has no JSON; regenerate it");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `the eval record's computed block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return EvalRecordSchema.parse(raw);
}

/** The loose shape a results file must have before the record reads it. */
const ResultsFileSchema = z.looseObject({
  provider: z.string(),
  model: z.string(),
  judgeProvider: z.string(),
  timestamp: iso,
  source: z.enum(["suite", "traces"]).optional(),
  summary: z.looseObject({
    total: count,
    passed: count,
    passRate: rate,
    cost: z.looseObject({ totalUsd: z.number() }),
  }),
  cases: z.array(z.looseObject({ id: z.string(), pass: z.boolean() })),
});

/** Validate a results file read from disk; a malformed one fails loudly, naming it. */
export function parseResultsFile(raw: unknown, file: string): EvalRunResult {
  const check = ResultsFileSchema.safeParse(raw);
  if (!check.success) {
    const issues = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${file}: not an eval results file: ${issues}`);
  }
  return raw as EvalRunResult;
}
