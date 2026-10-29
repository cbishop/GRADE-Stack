// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent
 *
 * Public surface of the reference-agent package — the agent runner, its option
 * and result types, the sample support email used as the default input, and
 * (Phase 4C) the release manifest that names the version under test.
 */

export {
  type AgentStep,
  DEFAULT_MAX_TURNS,
  MaxTurnsError,
  type RunAgentOptions,
  runReferenceAgent,
  type TriageResult,
  type TriageReview,
} from "./agent.ts";
export {
  BASE_SYSTEM_PROMPT,
  resolveMaxTurns,
  TRIAGE_GENERATION,
  triageSystemPrompt,
} from "./config.ts";
export {
  buildSelectionPrompt,
  connectSupportTools,
  type Grounding,
  groundTriage,
  MCP_URL_ENV,
  parseSelection,
  type RemoteTool,
  type SupportToolsClient,
  selectTool,
  ToolRefusedError,
  type ToolSelection,
} from "./mcp.ts";
export { type ReferenceReleaseOptions, referenceAgentRelease } from "./release.ts";
export { SAMPLE_EMAIL, type SupportEmail } from "./sample-email.ts";
export {
  CATEGORIES,
  PRIORITIES,
  SENTIMENTS,
  type Triage,
  TriageSchema,
} from "./triage-schema.ts";
