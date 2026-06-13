// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import type { TokenUsage } from "@grade-stack/core";

/**
 * Cost-per-success: the executive-legible unit metric (Phase 1B). Cost is
 * counted per *passing* outcome, not per call — a cheap agent that fails is not
 * cheap. Token counts are always reported; the dollar figure follows the
 * provider's pricing, with Ollama defaulting to \$0 plus an optional amortized
 * hardware rate (feeds the Phase 3D sovereign trade-off).
 */

/** USD per 1,000,000 tokens, split by direction. */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** How the dollar figure was derived — surfaced so no number is unexplained. */
export type PricingBasis = "list" | "amortized" | "free";

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  /** Total USD across the whole run. */
  totalUsd: number;
  /** USD per passing case. `null` when nothing passed (cost-per-success is undefined). */
  usdPerSuccess: number | null;
  /** Total tokens per passing case. `null` when nothing passed. */
  tokensPerSuccess: number | null;
  /** The rate table entry used. */
  price: TokenPrice;
  /** Where the rate came from. */
  basis: PricingBasis;
}

// Published Bedrock list prices (USD/MTok), matched by model-id substring.
// Source: Anthropic price list (Bedrock matches first-party for these models),
// verified 2026-06-12. Override per-model by extending this table.
const BEDROCK_PRICES: { match: RegExp; price: TokenPrice }[] = [
  { match: /haiku-4-5/, price: { inputPerMTok: 1.0, outputPerMTok: 5.0 } },
  { match: /sonnet-4-6/, price: { inputPerMTok: 3.0, outputPerMTok: 15.0 } },
  { match: /opus-4-8/, price: { inputPerMTok: 5.0, outputPerMTok: 25.0 } },
];
// The Bedrock default in this repo is Haiku 4.5; fall back to it for unknown ids.
const BEDROCK_FALLBACK: TokenPrice = { inputPerMTok: 1.0, outputPerMTok: 5.0 };

const FREE: TokenPrice = { inputPerMTok: 0, outputPerMTok: 0 };

/**
 * Optional amortized self-hosting rate for Ollama (USD/MTok, applied to input
 * and output alike), via `RELIABILITY_OLLAMA_USD_PER_MTOK`. Default 0 — Ollama
 * dollar cost is \$0 unless an explicit hardware-amortization rate is set.
 */
function ollamaAmortizedRate(): number {
  const raw = process.env.RELIABILITY_OLLAMA_USD_PER_MTOK;
  if (raw === undefined) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Resolve the price table entry and basis for a provider/model. */
export function priceFor(
  provider: string,
  model: string,
): { price: TokenPrice; basis: PricingBasis } {
  if (provider === "bedrock") {
    const entry = BEDROCK_PRICES.find((e) => e.match.test(model));
    return { price: entry?.price ?? BEDROCK_FALLBACK, basis: "list" };
  }
  if (provider === "ollama") {
    const rate = ollamaAmortizedRate();
    return rate > 0
      ? { price: { inputPerMTok: rate, outputPerMTok: rate }, basis: "amortized" }
      : { price: FREE, basis: "free" };
  }
  // `stub` and anything else: hermetic / no cost.
  return { price: FREE, basis: "free" };
}

/** Compute the cost breakdown for a run from its aggregate usage and pass count. */
export function computeCost(
  provider: string,
  model: string,
  usage: TokenUsage,
  passed: number,
): CostBreakdown {
  const { price, basis } = priceFor(provider, model);
  const totalUsd =
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalUsd,
    usdPerSuccess: passed > 0 ? totalUsd / passed : null,
    tokensPerSuccess: passed > 0 ? totalTokens / passed : null,
    price,
    basis,
  };
}
