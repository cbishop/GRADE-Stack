// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { ModelProvider, TokenUsage } from "@grade-stack/core";
import type { SupportEmail } from "./sample-email.ts";

export interface TriageResult {
  /** The model's raw, unvalidated output. Parsing/validation is intentionally absent. */
  raw: string;
  usage: TokenUsage;
  provider: string;
  model: string;
}

const SYSTEM_PROMPT = [
  "You are a customer-support triage assistant.",
  "Given one inbound support email, return a single JSON object with exactly these fields:",
  '  "category"     — one of: billing, technical, account, other',
  '  "priority"     — one of: low, medium, high, urgent',
  '  "sentiment"    — one of: positive, neutral, negative',
  '  "summary"      — one sentence describing the issue',
  '  "draft_reply"  — a short, professional reply to the customer',
  "Respond with only the JSON object and nothing else.",
].join("\n");

function renderUserPrompt(email: SupportEmail): string {
  return [
    "Triage the following support email.",
    "",
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    "",
    email.body,
  ].join("\n");
}

/**
 * The naive Phase 0 reference agent: one model call, no validation, no retries,
 * no tools. This is the deliberate "before" state that later phases measure and
 * improve. It runs identically against any {@link ModelProvider}.
 */
export async function runReferenceAgent(
  provider: ModelProvider,
  email: SupportEmail,
): Promise<TriageResult> {
  const result = await provider.generate({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: renderUserPrompt(email) }],
    maxTokens: 800,
    temperature: 0,
  });

  return {
    raw: result.text,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  };
}
