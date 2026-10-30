// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals
 *
 * Public surface of the evals package — the suite runner, the regression gate,
 * cost-per-success pricing, the CLI formatters, and the result types. Phase 4F
 * adds trace re-scoring, judge calibration and the eval record.
 */

export {
  CALIBRATION_MIN_AGREEMENT,
  CALIBRATION_MIN_KAPPA,
  CALIBRATION_MIN_LABELED,
  type CalibrationLabel,
  type CalibrationLabels,
  CalibrationLabelsSchema,
  type CalibrationReport,
  type CalibrationStatus,
  calibrate,
  calibrationStatus,
  cohensKappa,
  DEFAULT_LABELS_FILE,
  describeCalibration,
  parseCalibrationLabels,
  seedLabels,
} from "./calibrate.ts";
export { formatGateVerdict, formatRunResult } from "./format.ts";
export {
  baselineFromResult,
  evaluateGate,
  type GateBaseline,
  type GateOptions,
  type GateVerdict,
} from "./gate.ts";
export {
  type CostBreakdown,
  computeCost,
  type PricingBasis,
  priceFor,
  type TokenPrice,
} from "./pricing.ts";
export {
  type BuildEvalRecordInput,
  buildEvalRecord,
  DEFAULT_EVAL_RECORD,
  describeEvalRecord,
  EVAL_RECORD_BEGIN,
  EVAL_RECORD_END,
  type EvalRecord,
  EvalRecordSchema,
  parseEvalRecord,
  parseResultsFile,
  REAL_MODEL_MAX_AGE_DAYS,
  RESCORE_MAX_AGE_DAYS,
  type RecordInput,
  renderEvalRecord,
  suiteDefinitionHash,
} from "./record.ts";
export { renderRunHtml, renderRunMarkdown } from "./report.ts";
export {
  EVALS_DIR_ENV,
  evalsRoot,
  type RunEvalOptions,
  runEvalSuite,
  SUITE_CONFIG_FILE,
  suiteConfigPath,
} from "./run.ts";
export {
  type LoadedTraces,
  loadTraceCases,
  runTraceRescore,
  stampTraceResult,
  type TraceCase,
  type TraceRescoreOptions,
  traceTests,
} from "./traces.ts";
export type {
  CaseResult,
  EvalRunResult,
  EvalSource,
  EvalSummary,
  Phase,
  StepStatus,
  TraceCheck,
  TraceProvenance,
  TraceSkip,
  TraceStep,
} from "./types.ts";
export { PHASES } from "./types.ts";
