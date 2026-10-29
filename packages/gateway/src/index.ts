// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway
 *
 * Public surface of @grade-stack/gateway — the Phase 2C LLM gateway. It is the
 * credential-holding, server-side policy-enforcement layer the agent talks to in
 * place of a provider: the guardrail engine (`./policy`), the enforcement
 * service (`./gateway`), and the HTTP transport (`./connect`). The client seam
 * (`GatewayProvider`) and wire contract live in `@grade-stack/core` so the agent
 * bundle never depends on this credentialed package. Phase 4B adds the decision
 * log (`./decision-log`) and opt-in content capture (`./capture`); Phase 4C the
 * kill switch (`./kill-switch`) and the rollback drill (`./drill`). The paths to the two
 * executables — the server and the credential-isolation probe — are exported so
 * the CLI can spawn them without hard-coding paths.
 */

import { fileURLToPath } from "node:url";

export {
  CAPTURE_DIR_ENV,
  type CaptureRecord,
  CaptureRecordSchema,
  DEFAULT_CAPTURE_DIR,
  readCapture,
  resolveCaptureDir,
  writeCapture,
} from "./capture.ts";
export {
  type GatewayHandle,
  type GatewayServeOptions,
  serveGateway,
} from "./connect.ts";
export {
  type ControlRecord,
  ControlRecordSchema,
  DECISION_LOG_ENV,
  DEFAULT_DECISION_LOG_PATH,
  DecisionLog,
  DecisionLogError,
  type DecisionRecord,
  DecisionRecordSchema,
  isControlRecord,
  parseDecisionLog,
  type RequestRecord,
  RequestRecordSchema,
  readDecisionLog,
  resolveDecisionLogPath,
  sha256Hex,
} from "./decision-log.ts";
export { describeDecision } from "./explain.ts";
export { GatewayService, type GatewayServiceOptions } from "./gateway.ts";
export {
  DEFAULT_HALT_FILE,
  HALT_ENV,
  HALT_FILE_ENV,
  HaltFileError,
  type HaltRecord,
  HaltRecordSchema,
  type HaltResult,
  type HaltState,
  haltGateway,
  type KillSwitchActionOptions,
  parseHaltRecord,
  type ResumeResult,
  readHaltRecord,
  readHaltState,
  resolveHaltFilePath,
  resumeGateway,
} from "./kill-switch.ts";
export {
  applyInputPolicy,
  applyOutputPolicy,
  checkModel,
  DEFAULT_POLICY,
  type GatewayPolicy,
  type InputDecision,
  type OutputDecision,
} from "./policy.ts";
export {
  ConfidenceRouter,
  DEFAULT_ROUTER_CONFIG,
  type RouterConfig,
  type RouterDecision,
  type RouterProviders,
  resolveRouterFromEnv,
} from "./router.ts";
export { isolatedAgentEnv, STRIPPED_CREDENTIAL_VARS } from "./sandbox.ts";

/** Absolute path to the gateway server launcher — `bun <SERVER_BIN>` runs it. */
export const SERVER_BIN = fileURLToPath(new URL("./bin.ts", import.meta.url));
/** Absolute path to the credential-isolation probe (spawned by `gateway demo`). */
export const ISOLATION_PROBE_BIN = fileURLToPath(new URL("./isolation-probe.ts", import.meta.url));
