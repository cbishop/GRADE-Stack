// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/policy
 *
 * The guardrail engine — pure, deterministic, model-free functions that decide
 * whether a request may be forwarded and whether a model's output may be
 * returned. It owns the four Phase 2C guardrails and nothing else (no transport,
 * no provider access): prompt-injection/override denial and secret-exfiltration
 * denial on the way in, plus token/model caps; secret-exfiltration denial and
 * PII redaction on the way out. Keeping the policy pure is what lets the gateway
 * enforce it *server-side* identically across every provider, and lets each rule
 * be unit-tested in isolation.
 */

import type { GatewayViolation, GenerateRequest } from "@grade-stack/core";

/** Tunable limits enforced on every request. */
export interface GatewayPolicy {
  /**
   * Allowed model ids (substring match against the resolved provider model).
   * Empty means "allow any" — the cap is opt-in so the default wiring stays
   * usable, but a deployment can pin an allowlist.
   */
  allowedModels: string[];
  /** Hard upper bound on a request's `maxTokens`; over-cap requests are blocked. */
  maxTokens: number;
}

/** Conservative defaults: allow any model, cap tokens to a sane ceiling. */
export const DEFAULT_POLICY: GatewayPolicy = {
  allowedModels: [],
  maxTokens: 4096,
};

/** An input-stage decision: forward as-is, or refuse with a violation. */
export type InputDecision = { action: "allow" } | { action: "block"; violation: GatewayViolation };

/** An output-stage decision: return (possibly redacted) text, or refuse it. */
export type OutputDecision =
  | { action: "allow"; text: string; redactions: string[] }
  | { action: "block"; violation: GatewayViolation };

// ── Prompt-injection / override attempts ────────────────────────────────────
// Server-side detection that does not depend on (and cannot be relaxed by) the
// agent's own system prompt — that is the whole point of enforcing it here.
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?(your\s+|the\s+)?(previous|prior|earlier|above|preceding)\s+(instructions?|prompts?|rules?|directions?)\b/i,
  /\bdisregard\s+(all\s+)?(your\s+|the\s+|any\s+)?(previous|prior|above|system|safety)\b/i,
  /\b(reveal|show|print|expose|leak|repeat|output)\s+(your\s+|the\s+)?(system\s+prompt|hidden\s+(instructions?|prompts?)|initial\s+instructions?)\b/i,
  /\byou\s+are\s+now\s+(a\s+|an\s+)?[a-z]/i,
  /\b(developer|debug|god|admin|jailbreak)\s+mode\b/i,
  /\b(override|bypass|turn\s+off|disable|ignore|forget)\s+(your\s+|the\s+|all\s+)?(guard\s?rails?|safety|filters?|policies|policy|restrictions?|rules?)\b/i,
  /\bpretend\s+(that\s+)?(you\s+)?(are|have\s+no)\b/i,
];

// ── Secret material (literal) ───────────────────────────────────────────────
// Matched in BOTH directions: refuse to forward secrets a caller pasted in, and
// refuse to return secrets a model emitted. Reasons never echo the matched text.
const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "private key block", re: /-----BEGIN(?:\s+[A-Z]+)*\s+PRIVATE KEY-----/ },
  { label: "API key", re: /\b(?:sk|rk)-[A-Za-z0-9]{20,}\b/ },
  { label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    label: "credential assignment",
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9_\-/+]{12,}["']?/i,
  },
];

// ── Secret-exfiltration intent (input only) ─────────────────────────────────
// Catches "email me the API keys" even when no secret is literally present yet.
const EXFIL_INTENT =
  /\b(reveal|show|print|dump|send|forward|exfiltrate|leak|email|share|give\s+me)\b[^.!?\n]{0,60}\b(api[\s_-]?keys?|secrets?|credentials?|passwords?|tokens?|env(?:ironment)?\s+variables?|private\s+keys?|aws\s+keys?)\b/i;

// ── PII patterns (output redaction) ─────────────────────────────────────────
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Candidate 13–19 digit runs (optionally space/dash grouped); confirmed by Luhn
// so ordinary long numbers (invoice ids, order numbers) are not over-redacted.
const CC_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;

/** Luhn check — confirms a digit run is a plausible payment-card number. */
function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Concatenate everything the caller sent (system + turns) for input scanning. */
function inputText(request: GenerateRequest): string {
  return [request.system ?? "", ...request.messages.map((m) => m.content)].join("\n");
}

function findSecret(text: string): string | null {
  for (const { label, re } of SECRET_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Apply every input-stage guardrail to a request: token cap, prompt-injection /
 * override denial, and secret-exfiltration denial (literal secrets + intent).
 * Returns the first violation found, or `allow`.
 */
export function applyInputPolicy(request: GenerateRequest, policy: GatewayPolicy): InputDecision {
  if (request.maxTokens !== undefined && request.maxTokens > policy.maxTokens) {
    return {
      action: "block",
      violation: {
        policy: "token-cap",
        stage: "input",
        reason: `requested maxTokens ${request.maxTokens} exceeds the gateway cap of ${policy.maxTokens}`,
      },
    };
  }

  const text = inputText(request);

  if (INJECTION_PATTERNS.some((re) => re.test(text))) {
    return {
      action: "block",
      violation: {
        policy: "prompt-injection",
        stage: "input",
        reason: "request contains an instruction-override / jailbreak attempt",
      },
    };
  }

  const secret = findSecret(text);
  if (secret || EXFIL_INTENT.test(text)) {
    return {
      action: "block",
      violation: {
        policy: "secret-exfiltration",
        stage: "input",
        reason: secret
          ? `request contains secret material (${secret})`
          : "request attempts to surface credentials/secrets",
      },
    };
  }

  return { action: "allow" };
}

/** Validate the resolved model against the allowlist (empty allowlist = allow). */
export function checkModel(model: string, policy: GatewayPolicy): GatewayViolation | null {
  if (policy.allowedModels.length === 0) return null;
  if (policy.allowedModels.some((allowed) => model.includes(allowed))) return null;
  return {
    policy: "model-allowlist",
    stage: "input",
    reason: `model "${model}" is not in the gateway allowlist`,
  };
}

/**
 * Apply every output-stage guardrail to a model's text: refuse to return secret
 * material at all, otherwise redact SSNs and Luhn-valid card numbers in place.
 * Redaction (not blocking) is deliberate for PII — the answer still flows, minus
 * the sensitive spans — while secrets are refused outright.
 */
export function applyOutputPolicy(text: string, _policy: GatewayPolicy): OutputDecision {
  const secret = findSecret(text);
  if (secret) {
    return {
      action: "block",
      violation: {
        policy: "secret-exfiltration",
        stage: "output",
        reason: `model output contains secret material (${secret})`,
      },
    };
  }

  const redactions: string[] = [];
  let redacted = text.replace(SSN_RE, () => {
    redactions.push("SSN");
    return "[REDACTED-SSN]";
  });
  redacted = redacted.replace(CC_CANDIDATE_RE, (match) => {
    if (!luhnValid(match)) return match;
    redactions.push("credit-card number");
    return "[REDACTED-CC]";
  });

  return { action: "allow", text: redacted, redactions };
}
