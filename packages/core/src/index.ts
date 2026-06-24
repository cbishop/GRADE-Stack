// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core
 *
 * Public surface of @grade-stack/core — the ModelProvider abstraction, its
 * Bedrock/Ollama/stub implementations, the provider factory, and the
 * credential-free gateway client + wire contract (Phase 2C). Every model call in
 * the stack goes through this package.
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
  GATEWAY_GENERATE_PATH,
  type GatewayGenerateBody,
  type GatewayGenerateResponse,
  GatewayProvider,
  type GatewayProviderOptions,
  type GatewayViolation,
  GuardrailError,
} from "./providers/gateway.ts";
export { type OllamaOptions, OllamaProvider } from "./providers/ollama.ts";
export { type StubOptions, StubProvider } from "./providers/stub.ts";
export {
  type CapturedSpan,
  formatSpanTree,
  GENAI,
  genAiSystem,
  getTracer,
  initTracing,
  isTracingEnabled,
  OTEL_ENABLE_ENV,
  PHASE_ATTR,
  SpanKind,
  summarizeTraceCoverage,
  type TraceCoverage,
  type TracingHandle,
  traceProvider,
  type WithSpanOptions,
  withInMemoryTracing,
  withSpan,
} from "./tracing.ts";
export type {
  ChatMessage,
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderName,
  Role,
  TokenUsage,
} from "./types.ts";
