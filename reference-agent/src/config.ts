// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/config
 *
 * The reference agent's release-relevant configuration in one place: the base
 * system prompt, the generation parameters, and the turn-bound resolution. The
 * agent (`./agent`) runs on these, and the release manifest (`./release`) hashes
 * exactly these, so a change to any of them shows up in `reliability release
 * diff` (Phase 4C).
 */

import { DEFAULT_MAX_TURNS } from "@grade-stack/core";

/** The system prompt the planner prepends to the triage JSON Schema. */
export const BASE_SYSTEM_PROMPT = [
  "You are a customer-support triage assistant.",
  "Given one inbound support email, classify it and draft a reply.",
  "Respond with a single JSON object — and nothing else, no Markdown fences —",
  "that conforms exactly to this JSON Schema:",
].join("\n");

/** Generation parameters for the executor's one model call per turn. */
export const TRIAGE_GENERATION = { maxTokens: 800, temperature: 0 } as const;

/** The enforced turn bound: explicit, else RELIABILITY_MAX_TURNS, else the default. */
export function resolveMaxTurns(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.RELIABILITY_MAX_TURNS;
  if (fromEnv !== undefined) {
    const n = Number.parseInt(fromEnv, 10);
    if (!Number.isNaN(n)) return n;
  }
  return DEFAULT_MAX_TURNS;
}

/** The system prompt with the schema block, exactly as the planner sends it (no MCP grounding). */
export function triageSystemPrompt(jsonSchema: Record<string, unknown>): string {
  return `${BASE_SYSTEM_PROMPT}\n${JSON.stringify(jsonSchema, null, 2)}`;
}
