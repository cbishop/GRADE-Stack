// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { GenerateRequest, GenerateResult, ModelProvider } from "../types.ts";

/**
 * A deterministic, hermetic model provider — no network, no credentials, no
 * cost. It exists for **one** purpose: backing the CI eval gate so a regression
 * is caught programmatically and reproducibly (ADR 0003). It is NOT a model and
 * makes no claim about real agent quality; Bedrock/Ollama measure that locally
 * and (from Phase 2A) on `main`.
 *
 * Two behaviours, discriminated purely by the request — same seam every other
 * provider uses, so it drops into the agent and the LLM-as-judge unchanged:
 *
 *   - **agent triage:** when the system prompt is the triage prompt, classify
 *     the email with a small deterministic keyword rule set and emit the exact
 *     JSON contract the suite validates.
 *   - **judge:** otherwise the request is a promptfoo llm-rubric grading prompt;
 *     return the grader JSON promptfoo expects (`{pass, score, reason}`). The
 *     stub judge always passes — the gate's signal comes from the deterministic
 *     JS assertions, which `--degraded` breaks.
 */

interface Triage {
  category: "billing" | "technical" | "account" | "other";
  priority: "low" | "medium" | "high" | "urgent";
  sentiment: "positive" | "neutral" | "negative";
  summary: string;
  draft_reply: string;
}

/** True when this request is the reference agent's triage call (not the judge). */
function isTriageRequest(request: GenerateRequest): boolean {
  return (request.system ?? "").toLowerCase().includes("triage assistant");
}

/** The email text the agent was handed, for keyword classification. */
function emailText(request: GenerateRequest): string {
  return request.messages
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();
}

/** Deterministic category rules. Order matters — first match wins. */
function classifyCategory(text: string): Triage["category"] {
  if (
    /\bcancel\b|not renew|renew our|primary contact|update the email|change the [^.]*email/.test(
      text,
    )
  ) {
    return "account";
  }
  if (/charge|invoice|refund|late fee|billed|payment|\$\d/.test(text)) {
    return "billing";
  }
  if (
    /log ?in|redirect|\b500\b|endpoint|\bapi\b|outage|down|error|timeout|export|broken/.test(text)
  ) {
    return "technical";
  }
  return "other";
}

function classifySentiment(text: string): Triage["sentiment"] {
  if (/thank|fantastic|great job|appreciate|love|keep it up/.test(text)) {
    return "positive";
  }
  if (
    /frustrat|losing patience|patience|angry|unacceptable|bad|broken|down|mistake|disput/.test(text)
  ) {
    return "negative";
  }
  return "neutral";
}

function classifyPriority(text: string): Triage["priority"] {
  if (/urgent|asap|immediately|everything is down|escalate|right now|actively costing/.test(text)) {
    return "urgent";
  }
  if (/today|before|deadline|locked out|blocking|2pm|demo/.test(text)) {
    return "high";
  }
  if (/no rush|when you get a chance|whenever/.test(text)) {
    return "low";
  }
  return "medium";
}

/** A short, professional draft reply. Declines/clarifies on low-information or
 * third-party-data requests rather than inventing an issue. */
function draftReply(text: string, category: Triage["category"]): string {
  if (text.trim().length === 0 || /no subject/.test(text)) {
    return "Thanks for reaching out — could you share a few more details about what you need help with so we can assist you?";
  }
  if (/account details|invoice amounts|paste whatever you have|full account/.test(text)) {
    return "Thanks for getting in touch. For privacy reasons we can't share another customer's account details. If this is your own account, please verify your identity and we'll be glad to help.";
  }
  if (category === "other" && /cruise|prize|congratulations|free \d/.test(text)) {
    return "Thanks for your message. This doesn't appear to relate to your account or our support scope, so we won't be able to action it — let us know if there's something we can help with.";
  }
  return "Thanks for reaching out — we've logged your request and a member of the team will follow up shortly with the next steps. We appreciate your patience.";
}

function triage(request: GenerateRequest): Triage {
  const text = emailText(request);
  const category = classifyCategory(text);
  return {
    category,
    priority: classifyPriority(text),
    sentiment: classifySentiment(text),
    summary: `Customer ${category} request based on the submitted support email.`,
    draft_reply: draftReply(text, category),
  };
}

/** Rough, deterministic token estimate so cost/usage plumbing has real numbers. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface StubOptions {
  /** Reported model id. */
  model?: string;
}

const DEFAULT_MODEL = "stub-deterministic-v1";

/** Deterministic, network-free provider for the CI eval gate. See ADR 0003. */
export class StubProvider implements ModelProvider {
  readonly name = "stub" as const;
  readonly model: string;

  constructor(opts: StubOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const inputText = `${request.system ?? ""}\n${request.messages.map((m) => m.content).join("\n")}`;

    const text = isTriageRequest(request)
      ? JSON.stringify(triage(request))
      : // Judge mode: promptfoo llm-rubric grader response. The stub judge
        // always passes; the gate's regression signal is the deterministic JS
        // assertions, not the judge.
        JSON.stringify({ pass: true, score: 1, reason: "stub judge: rubric satisfied" });

    return {
      text,
      usage: {
        inputTokens: estimateTokens(inputText),
        outputTokens: estimateTokens(text),
      },
      provider: this.name,
      model: this.model,
    };
  }
}
