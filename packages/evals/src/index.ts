// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals
 *
 * Public surface of the evals package — the suite runner, the regression gate,
 * cost-per-success pricing, the CLI formatters, and the result types.
 */

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
export { type RunEvalOptions, runEvalSuite } from "./run.ts";
export type {
  CaseResult,
  EvalRunResult,
  EvalSummary,
  Phase,
  StepStatus,
  TraceCheck,
  TraceStep,
} from "./types.ts";
export { PHASES } from "./types.ts";
