// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core
 *
 * Public surface of @grade-stack/core — the ModelProvider abstraction, its
 * Bedrock/Ollama/stub implementations, and the provider factory. Every model
 * call in the stack goes through this package.
 */

export { createProvider, resolveProviderName } from "./factory.ts";
export { type BedrockOptions, BedrockProvider } from "./providers/bedrock.ts";
export { type OllamaOptions, OllamaProvider } from "./providers/ollama.ts";
export { type StubOptions, StubProvider } from "./providers/stub.ts";
export type {
  ChatMessage,
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderName,
  Role,
  TokenUsage,
} from "./types.ts";
