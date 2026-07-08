// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/router
 *
 * The **confidence router** (Week 3, ADR 0015): the max-reliability / min-cost
 * policy that lets a cheap local model handle the confident bulk of traffic and
 * escalates only the low-confidence tail to a frontier provider. It is a pure
 * orchestration layer over two {@link ModelProvider}s — no credentials, no
 * transport — so it drops into {@link GatewayService} the same way the guardrail
 * policy does, and the escalated result still flows back through the output
 * guardrails.
 *
 * The confidence signal is **self-consistency**, not log-probs: sample the local
 * model N times at a non-zero temperature and measure how often the samples
 * agree on a *consensus key*. High agreement ⇒ the model is sure ⇒ keep the
 * local answer for \$0; low agreement ⇒ escalate. This mirrors the sibling
 * `lora` project's `triage/router.py` — the same modal-vote-and-escalate logic
 * the Week 3 sweep validated — but generalized: the consensus key is a
 * configurable list of JSON fields (for triage, the three closed enums
 * `category`/`priority`/`sentiment`), so the gateway stays task-agnostic. An
 * empty field list falls back to whole-output text agreement.
 */

import {
  extractJsonObject,
  type GatewayRouting,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  type ProviderName,
  resolveProviderName,
} from "@grade-stack/core";

/** Enable the router server-side; anything else leaves the gateway a plain forwarder. */
const ROUTER_ENABLE_ENV = "RELIABILITY_ROUTER";
const ROUTER_LOCAL_ENV = "RELIABILITY_ROUTER_LOCAL";
const ROUTER_ESCALATE_ENV = "RELIABILITY_ROUTER_ESCALATE_TO";
const ROUTER_SAMPLES_ENV = "RELIABILITY_ROUTER_SAMPLES";
const ROUTER_TEMPERATURE_ENV = "RELIABILITY_ROUTER_TEMPERATURE";
const ROUTER_THRESHOLD_ENV = "RELIABILITY_ROUTER_THRESHOLD";
const ROUTER_CONSENSUS_FIELDS_ENV = "RELIABILITY_ROUTER_CONSENSUS_FIELDS";

/** Tunable knobs for {@link ConfidenceRouter}; every field has a sane default. */
export interface RouterConfig {
  /** The cheap first-pass provider, sampled N times for self-consistency. */
  local: ProviderName;
  /** The frontier provider the low-confidence tail escalates to. */
  escalateTo: ProviderName;
  /** Number of local votes to draw (N ≥ 1). */
  samples: number;
  /** Sampling temperature for the local votes — must be > 0 to see variance. */
  temperature: number;
  /** Accept the local answer when confidence ≥ this (0..1); else escalate. */
  threshold: number;
  /**
   * JSON fields whose values form the consensus key. For triage:
   * `["category", "priority", "sentiment"]` — agreement on the closed enums,
   * ignoring free-text `summary`/`draft_reply` variation. Empty ⇒ agreement on
   * the whole trimmed output text.
   */
  consensusFields: string[];
}

/** Week 3's best operating point: N=5 votes, escalate below majority agreement. */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  local: "ollama",
  escalateTo: "bedrock",
  samples: 5,
  temperature: 0.7,
  threshold: 0.5,
  consensusFields: ["category", "priority", "sentiment"],
};

/** The two resolved providers the router orchestrates. */
export interface RouterProviders {
  local: ModelProvider;
  escalation: ModelProvider;
}

/** A routed generation: the served result plus the routing decision. */
export interface RouterDecision {
  result: GenerateResult;
  routing: GatewayRouting;
}

/**
 * Reduce one raw model output to its consensus key, or `undefined` when it does
 * not parse / is missing a consensus field. With no configured fields the key is
 * the trimmed text; otherwise it is the JSON serialization of the field tuple,
 * so two outputs agree iff every consensus field matches (free-text fields are
 * deliberately ignored).
 */
function consensusKey(text: string, fields: string[]): string | undefined {
  if (fields.length === 0) {
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const obj = extractJsonObject(text);
  if (obj === null || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  const tuple: unknown[] = [];
  for (const field of fields) {
    const value = record[field];
    if (value === undefined || value === null) return undefined;
    tuple.push(value);
  }
  return JSON.stringify(tuple);
}

/**
 * The confidence router. Constructed once with a {@link RouterConfig}, it turns
 * a single {@link GenerateRequest} into N local votes, measures their agreement,
 * and either returns the modal local answer (\$0 escalation) or forwards the
 * request to the frontier provider. Both providers are injected per call so the
 * gateway resolves them through its own (credentialed) `resolveProvider`, and so
 * tests can drive the whole decision against hermetic stubs.
 */
export class ConfidenceRouter {
  readonly config: RouterConfig;

  constructor(config: Partial<RouterConfig> = {}) {
    const merged = { ...DEFAULT_ROUTER_CONFIG, ...config };
    // A single vote can never disagree with itself; clamp to a sane floor so a
    // misconfigured N=0 does not make every request escalate silently.
    this.config = { ...merged, samples: Math.max(1, Math.floor(merged.samples)) };
  }

  /**
   * Route one request. Draws {@link RouterConfig.samples} local votes at the
   * configured temperature, computes the modal consensus key and its agreement
   * fraction, and keeps the local answer when confidence ≥ threshold — otherwise
   * escalates the *original* request (temperature untouched) to the frontier
   * provider. The returned result's `provider`/`model` reflect whichever
   * provider actually served it, so downstream cost accounting stays honest.
   */
  async route(request: GenerateRequest, providers: RouterProviders): Promise<RouterDecision> {
    const { samples, temperature, threshold, consensusFields } = this.config;

    // ── Draw N local votes concurrently, each at the sampling temperature. ──
    const voteRequest: GenerateRequest = { ...request, temperature };
    const votes = await Promise.all(
      Array.from({ length: samples }, () => providers.local.generate(voteRequest)),
    );

    // ── Tally agreement on the consensus key (invalid votes dilute it). ──────
    const counts = new Map<string, number>();
    const keys = votes.map((v) => consensusKey(v.text, consensusFields));
    for (const key of keys) {
      if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let modalKey: string | undefined;
    let modalCount = 0;
    // Map iteration is insertion order, so ties resolve to the first-seen key —
    // matching the Python router's `Counter.most_common(1)` tie-break.
    for (const [key, count] of counts) {
      if (count > modalCount) {
        modalKey = key;
        modalCount = count;
      }
    }

    const validSamples = keys.filter((k) => k !== undefined).length;
    const confidence = modalCount / samples;
    const confident = modalKey !== undefined && confidence >= threshold;

    if (confident) {
      // Return the first vote that carried the modal key, so its full payload
      // (summary/draft) rides along — not just the enum tuple.
      // biome-ignore lint/style/noNonNullAssertion: modalKey came from a vote and samples >= 1, so a vote is always present.
      const chosen = votes[keys.indexOf(modalKey)] ?? votes[0]!;
      return {
        result: chosen,
        routing: {
          escalated: false,
          confidence,
          samples,
          validSamples,
          servedBy: providers.local.name,
        },
      };
    }

    // ── Low confidence: escalate the original request to the frontier tier. ──
    const escalated = await providers.escalation.generate(request);
    return {
      result: escalated,
      routing: {
        escalated: true,
        confidence,
        samples,
        validSamples,
        servedBy: providers.escalation.name,
      },
    };
  }
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseFields(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/**
 * Build a {@link ConfidenceRouter} from the environment, or `undefined` when
 * routing is not enabled. This is the "escalate low-confidence to the frontier
 * becomes a running config" seam: the gateway process opts in with
 * `RELIABILITY_ROUTER=1` and tunes the operating point with the sibling
 * `RELIABILITY_ROUTER_*` variables. Absent the enable flag the gateway stays a
 * plain single-provider forwarder, so nothing about the default path changes.
 */
export function resolveRouterFromEnv(
  env: Record<string, string | undefined> = process.env,
): ConfidenceRouter | undefined {
  const enabled = env[ROUTER_ENABLE_ENV]?.toLowerCase();
  if (enabled !== "1" && enabled !== "true" && enabled !== "on") return undefined;

  const d = DEFAULT_ROUTER_CONFIG;
  return new ConfidenceRouter({
    local: resolveProviderName(env[ROUTER_LOCAL_ENV] ?? d.local),
    escalateTo: resolveProviderName(env[ROUTER_ESCALATE_ENV] ?? d.escalateTo),
    samples: parseNumber(env[ROUTER_SAMPLES_ENV], d.samples),
    temperature: parseNumber(env[ROUTER_TEMPERATURE_ENV], d.temperature),
    threshold: parseNumber(env[ROUTER_THRESHOLD_ENV], d.threshold),
    consensusFields: parseFields(env[ROUTER_CONSENSUS_FIELDS_ENV], d.consensusFields),
  });
}
