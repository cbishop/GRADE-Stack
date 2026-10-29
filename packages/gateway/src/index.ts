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
 * kill switch (`./kill-switch`) and the rollback drill (`./drill`); Phase 4D the
 * human review queue (`./review-queue`). The paths to the two
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
  isRequestRecord,
  isReviewRecord,
  parseDecisionLog,
  type RequestRecord,
  RequestRecordSchema,
  type ReviewRecord,
  ReviewRecordSchema,
  readDecisionLog,
  resolveDecisionLogPath,
  sha256Hex,
} from "./decision-log.ts";
export {
  DEFAULT_DRILL_PROBES,
  DEFAULT_TIME_TO_HALT_THRESHOLD_MS,
  type DrillOptions,
  type DrillRecord,
  DrillRecordError,
  DrillRecordSchema,
  drillFileName,
  parseDrillRecord,
  readLatestDrill,
  runKillSwitchDrill,
  writeDrillRecord,
} from "./drill.ts";
export { describeDecision, describeReviewItem, explainReviewItem } from "./explain.ts";
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
  DEFAULT_REVIEW_POLICY,
  type GatewayPolicy,
  type InputDecision,
  type OutputDecision,
  type ReviewPolicy,
} from "./policy.ts";
export {
  type ApprovedEvent,
  ApprovedEventSchema,
  type ApproveInput,
  AUTOMATED_ACTORS,
  configuredTriggers,
  DEFAULT_REVIEW_QUEUE_PATH,
  deriveReviewItems,
  type HoldInput,
  holdReasons,
  isAutomatedActor,
  newReviewId,
  parseReviewQueue,
  type QueuedEvent,
  QueuedEventSchema,
  REVIEW_BELOW_ENV,
  REVIEW_ON_MAX_TURNS_ENV,
  REVIEW_ON_REDACTION_ENV,
  REVIEW_ON_REQUEST_ENV,
  REVIEW_QUEUE_ENV,
  type RejectedEvent,
  RejectedEventSchema,
  type RejectInput,
  type ReviewEvent,
  ReviewEventSchema,
  type ReviewItem,
  ReviewQueue,
  ReviewQueueError,
  readReviewQueue,
  resolveReviewPolicy,
  resolveReviewPolicyFromEnv,
  resolveReviewQueuePath,
} from "./review-queue.ts";
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
