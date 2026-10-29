// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/types
 *
 * The provider abstraction's core contracts — the provider-agnostic
 * GenerateRequest/Result, token usage, and the ModelProvider interface that
 * every model call in the stack flows through.
 */

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
  /**
   * Ask the gateway to hold the answer for a named human (Phase 4D, ADR 0019).
   * The gateway queues a review item and returns the result flagged as held.
   * Used by L1 agents from Phase 4E; providers other than the gateway ignore it.
   */
  requiresReview?: boolean;
}

/**
 * A result the gateway held for human review (Phase 4D): the review item id and
 * why it was held. The text is returned so a reviewer can see it, but it is not
 * released until a named person approves the item (`reliability review approve`).
 */
export interface ReviewHold {
  held: true;
  /** Review item id, e.g. `rv-0123456789ab`. */
  id: string;
  /** Which trigger fired: `low-confidence`, `max-turns`, `output-redaction` or `requested`. */
  trigger: string;
  /** One plain-language sentence saying why the result was held. */
  reason: string;
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
  /** Present when the gateway held this result for human review (Phase 4D). */
  review?: ReviewHold;
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
