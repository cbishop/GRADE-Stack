// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core
 *
 * Public surface of @grade-stack/core — the ModelProvider abstraction, its
 * Bedrock/Ollama/stub implementations, the provider factory, and the
 * credential-free gateway client + wire contract (Phase 2C). Every model call in
 * the stack goes through this package. Phase 4C adds the release manifest
 * (`./release`), stamped into eval results and onto the agent's root span.
 */

export {
  AIRGAP_ENV,
  createGuardedFetch,
  EgressBlockedError,
  installEgressGuard,
  installEgressGuardFromEnv,
  isAirgapEnabled,
  isLoopbackHost,
} from "./airgap.ts";
export {
  AGENT_TOKEN_ENV,
  agentToken,
  type CreateProviderOptions,
  createDirectProvider,
  createProvider,
  GATEWAY_TOGGLE_ENV,
  GATEWAY_URL_ENV,
  gatewayUrl,
  isAgentSandbox,
  resolveProviderName,
  SANDBOX_ENV,
} from "./factory.ts";
export {
  type AgentPhase,
  type AgentStep,
  DEFAULT_MAX_TURNS,
  type Executor,
  extractJsonObject,
  MaxTurnsError,
  type PEVResult,
  type PlanFeedback,
  type Planner,
  type RunPEVOptions,
  runPEV,
  type StepStatus,
  type ValidationResult,
  type Validator,
  zodValidator,
} from "./pev.ts";
export { type BedrockOptions, BedrockProvider } from "./providers/bedrock.ts";
export {
  CALLER_ID_HEADER,
  GATEWAY_GENERATE_PATH,
  GATEWAY_REVIEW_PATH,
  type GatewayGenerateBody,
  type GatewayGenerateResponse,
  GatewayProvider,
  type GatewayProviderOptions,
  type GatewayReviewBody,
  type GatewayReviewResponse,
  type GatewayRouting,
  type GatewayViolation,
  GuardrailError,
  IDENTITY_ID_PATTERN,
  REQUEST_ID_HEADER,
  REVIEW_TRIGGERS,
  type RequestContext,
  type ReviewTrigger,
  SESSION_ID_HEADER,
} from "./providers/gateway.ts";
export { type OllamaOptions, OllamaProvider } from "./providers/ollama.ts";
export { type StubOptions, StubProvider } from "./providers/stub.ts";
export {
  buildReleaseManifest,
  canonicalJson,
  describeRelease,
  diffReleases,
  GIT_DIRTY_ENV,
  GIT_SHA_ENV,
  type GitState,
  hashOf,
  parseReleaseManifest,
  RELEASE_ATTRS,
  type ReleaseDiff,
  type ReleaseInput,
  type ReleaseManifest,
  ReleaseManifestError,
  ReleaseManifestSchema,
  type ReleaseTool,
  ReleaseToolSchema,
  readGitState,
  releaseFromJson,
  releaseSpanAttributes,
} from "./release.ts";
export {
  type CapturedSpan,
  formatSpanTree,
  GENAI,
  GENAI_CONTENT,
  genAiSystem,
  getTracer,
  IDENTITY_ATTRS,
  identityAttributes,
  initTracing,
  isContentCaptureEnabled,
  isTracingEnabled,
  OTEL_ENABLE_ENV,
  PHASE_ATTR,
  type RequestIdentity,
  recordRequestOutput,
  type Span,
  SpanKind,
  summarizeTraceCoverage,
  TRACE_CONTENT_ENV,
  type TraceCoverage,
  type TraceProviderOptions,
  type TracingHandle,
  traceProvider,
  type WithSpanOptions,
  withInMemoryTracing,
  withRequestSpan,
  withSpan,
} from "./tracing.ts";
export type {
  ChatMessage,
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderName,
  ReviewHold,
  Role,
  TokenUsage,
} from "./types.ts";
