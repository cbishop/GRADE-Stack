// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent
 *
 * Public surface of the reference-agent package — the agent runner, its option
 * and result types, and the sample support email used as the default input.
 */

export {
  DEFAULT_MAX_TURNS,
  MaxTurnsError,
  type RunAgentOptions,
  runReferenceAgent,
  type TriageResult,
} from "./agent.ts";
export { SAMPLE_EMAIL, type SupportEmail } from "./sample-email.ts";
