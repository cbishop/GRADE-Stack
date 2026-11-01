// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/types
 *
 * The provider abstraction's core contracts — the provider-agnostic
 * GenerateRequest/Result, token usage, and the ModelProvider interface that
 * every model call in the stack flows through.
 *
 * Security finding 1 (2026-10-29 review): the request and its messages are
 * zod schemas, and the TS types derive from them, so the gateway (server) and
 * its client cannot drift from what the wire accepts.
 */

import { z } from "zod";

/**
 * The model providers the stack can talk to. `stub` is a deterministic,
 * hermetic provider (no network, no credentials) used only by the CI eval gate
 * — see ADR 0003. `bedrock`/`ollama` are the real model paths.
 */
export const ProviderNameSchema = z.enum(["bedrock", "ollama", "stub"]);

/** One provider name (derived from {@link ProviderNameSchema}). */
export type ProviderName = z.infer<typeof ProviderNameSchema>;

/**
 * Every role a provider's own wire format may carry. `system` exists only for
 * providers that put the system prompt in the message list (Ollama builds such
 * a list from {@link GenerateRequest.system}); a {@link ChatMessage} in a
 * request never carries it, and the wire schema refuses it.
 */
export type Role = "system" | "user" | "assistant";

/** Longest `system` or message `content` a request may carry, in characters. */
export const MAX_REQUEST_TEXT_CHARS = 100_000;
/** Most turns a request may carry. */
export const MAX_REQUEST_MESSAGES = 200;

/**
 * One user or assistant turn. `content` is a plain string: the guardrails scan
 * text, so a content-block array (which they would see as `[object Object]`)
 * is refused rather than forwarded. A `system` role is refused too; the system
 * prompt goes in {@link GenerateRequest.system}, where the guardrails read it.
 */
export const ChatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_REQUEST_TEXT_CHARS),
});

/** One user or assistant turn (derived from {@link ChatMessageSchema}). */
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * A single, provider-agnostic generation request. Every model call in the stack
 * (the reference agent, eval judges, the gateway) is shaped like this so
 * providers stay swappable. Strict: an unknown key is refused, not passed on.
 *
 * - `system`: the system prompt, kept separate from the turn messages.
 * - `messages`: user/assistant turns (no system role here; use `system`).
 * - `requiresReview`: ask the gateway to hold the answer for a named human
 *   (Phase 4D, ADR 0019). The gateway queues a review item and returns the
 *   result flagged as held. Used by L1 agents from Phase 4E; providers other
 *   than the gateway ignore it.
 */
export const GenerateRequestSchema = z.strictObject({
  system: z.string().max(MAX_REQUEST_TEXT_CHARS).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(MAX_REQUEST_MESSAGES),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  requiresReview: z.boolean().optional(),
});

/** A generation request (derived from {@link GenerateRequestSchema}). */
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

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
  /**
   * The same provider on a new session (Phase 4E). Only the gateway client has
   * sessions (the gateway counts an agent's turns per session); the agent opens
   * one per run. Providers without sessions omit it.
   */
  withSession?(sessionId: string): ModelProvider;
}
