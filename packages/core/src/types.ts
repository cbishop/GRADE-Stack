// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * The model providers the stack can talk to. `stub` is a deterministic,
 * hermetic provider (no network, no credentials) used only by the CI eval gate
 * — see ADR 0003. `bedrock`/`ollama` are the real model paths.
 */
export type ProviderName = "bedrock" | "ollama" | "stub";

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/**
 * A single, provider-agnostic generation request. Every model call in the stack
 * — the reference agent now, eval judges in 1A, the gateway in 2C — is shaped
 * like this so providers stay swappable.
 */
export interface GenerateRequest {
  /** System prompt, kept separate from the turn messages. */
  system?: string;
  /** User/assistant turns (no system role here — use `system`). */
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  provider: ProviderName;
  model: string;
}

/**
 * The one interface through which all model invocation flows. Implementations
 * live in `./providers`. No reliability tooling here yet — just invocation.
 */
export interface ModelProvider {
  readonly name: ProviderName;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
