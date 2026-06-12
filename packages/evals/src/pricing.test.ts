// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { computeCost, priceFor } from "./pricing.ts";

afterEach(() => {
  delete process.env.RELIABILITY_OLLAMA_USD_PER_MTOK;
});

describe("priceFor", () => {
  test("bedrock haiku uses list price; unknown bedrock model falls back to haiku", () => {
    expect(priceFor("bedrock", "us.anthropic.claude-haiku-4-5-20251001-v1:0")).toEqual({
      price: { inputPerMTok: 1.0, outputPerMTok: 5.0 },
      basis: "list",
    });
    expect(priceFor("bedrock", "some-unlisted-model").basis).toBe("list");
    expect(priceFor("bedrock", "some-unlisted-model").price).toEqual({
      inputPerMTok: 1.0,
      outputPerMTok: 5.0,
    });
  });

  test("bedrock sonnet uses its own list price", () => {
    expect(priceFor("bedrock", "claude-sonnet-4-6").price).toEqual({
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
    });
  });

  test("ollama is free by default, amortized when a rate is set", () => {
    expect(priceFor("ollama", "llama3.1").basis).toBe("free");
    process.env.RELIABILITY_OLLAMA_USD_PER_MTOK = "0.5";
    expect(priceFor("ollama", "llama3.1")).toEqual({
      price: { inputPerMTok: 0.5, outputPerMTok: 0.5 },
      basis: "amortized",
    });
  });

  test("stub is always free", () => {
    expect(priceFor("stub", "stub-deterministic-v1").basis).toBe("free");
  });
});

describe("computeCost", () => {
  test("cost-per-success divides total dollars/tokens by passing cases", () => {
    // 2M input @ $1, 1M output @ $5 = $2 + $5 = $7 total; 4 passed -> $1.75 each.
    const cost = computeCost(
      "bedrock",
      "claude-haiku-4-5",
      { inputTokens: 2_000_000, outputTokens: 1_000_000 },
      4,
    );
    expect(cost.totalUsd).toBeCloseTo(7.0, 5);
    expect(cost.usdPerSuccess).toBeCloseTo(1.75, 5);
    expect(cost.tokensPerSuccess).toBe(750_000);
  });

  test("cost-per-success is null when nothing passed", () => {
    const cost = computeCost(
      "bedrock",
      "claude-haiku-4-5",
      { inputTokens: 100, outputTokens: 50 },
      0,
    );
    expect(cost.usdPerSuccess).toBeNull();
    expect(cost.tokensPerSuccess).toBeNull();
  });

  test("ollama reports tokens but $0 by default", () => {
    const cost = computeCost("ollama", "llama3.1", { inputTokens: 1000, outputTokens: 1000 }, 5);
    expect(cost.totalUsd).toBe(0);
    expect(cost.usdPerSuccess).toBe(0);
    expect(cost.tokensPerSuccess).toBe(400);
  });
});
