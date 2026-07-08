// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/router.test
 *
 * Tests the confidence router (ADR 0015) end to end:
 *
 *   - self-consistency: full agreement keeps the local answer for \$0, no
 *     escalation; a split vote below threshold escalates to the frontier tier;
 *   - the consensus key ignores free-text fields (agreement is on the enums);
 *   - invalid/unparseable votes dilute confidence against the N denominator;
 *   - through {@link GatewayService}: output guardrails still wrap the escalated
 *     result, both provider tiers are checked against the model allowlist, and
 *     the routing decision is surfaced on the response;
 *   - `resolveRouterFromEnv` is off by default and reads the operating point
 *     from `RELIABILITY_ROUTER_*`.
 */

import { describe, expect, test } from "bun:test";
import type {
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderName,
} from "@grade-stack/core";
import { GatewayService } from "./gateway.ts";
import type { GatewayPolicy } from "./policy.ts";
import { ConfidenceRouter, resolveRouterFromEnv } from "./router.ts";

/** A valid triage JSON string; free-text fields vary independently of the enums. */
function triage(
  category: string,
  priority: string,
  sentiment: string,
  draft = "Thanks — we'll help.",
): string {
  return JSON.stringify({ category, priority, sentiment, summary: "s", draft_reply: draft });
}

/** A provider that returns a scripted sequence of texts and counts its calls. */
function sequenceProvider(texts: string[], name: ProviderName = "ollama") {
  const state = { calls: 0 };
  const provider: ModelProvider = {
    name,
    model: `${name}-test`,
    generate(_req: GenerateRequest): Promise<GenerateResult> {
      const text = texts[state.calls] ?? texts[texts.length - 1] ?? "";
      state.calls += 1;
      return Promise.resolve({
        text,
        usage: { inputTokens: 1, outputTokens: 1 },
        provider: name,
        model: `${name}-test`,
      });
    },
  };
  return { provider, state };
}

/** A provider that always returns one text and counts its calls. */
function constantProvider(text: string, name: ProviderName) {
  return sequenceProvider([text], name);
}

const REQ: GenerateRequest = { messages: [{ role: "user", content: "triage this" }] };
const CONSENSUS = ["category", "priority", "sentiment"];

describe("ConfidenceRouter — self-consistency voting", () => {
  test("full agreement keeps the local answer, no escalation ($0)", async () => {
    const vote = triage("billing", "high", "neutral");
    const local = sequenceProvider([vote, vote, vote, vote, vote]);
    const escalation = constantProvider(triage("other", "low", "neutral"), "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });

    const { result, routing } = await router.route(REQ, {
      local: local.provider,
      escalation: escalation.provider,
    });

    expect(routing.escalated).toBe(false);
    expect(routing.confidence).toBe(1);
    expect(routing.servedBy).toBe("ollama");
    expect(result.text).toBe(vote);
    expect(local.state.calls).toBe(5);
    expect(escalation.state.calls).toBe(0); // frontier never touched
  });

  test("a split vote below threshold escalates to the frontier", async () => {
    const local = sequenceProvider([
      triage("billing", "high", "neutral"),
      triage("technical", "low", "positive"),
      triage("account", "urgent", "negative"),
      triage("other", "medium", "neutral"),
      triage("billing", "low", "positive"),
    ]); // five distinct triples → modal count 1 → confidence 0.2
    const escalated = triage("technical", "high", "negative", "Escalated frontier reply.");
    const escalation = constantProvider(escalated, "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });

    const { result, routing } = await router.route(REQ, {
      local: local.provider,
      escalation: escalation.provider,
    });

    expect(routing.escalated).toBe(true);
    expect(routing.confidence).toBeCloseTo(0.2, 5);
    expect(routing.servedBy).toBe("bedrock");
    expect(result.text).toBe(escalated);
    expect(result.provider).toBe("bedrock"); // cost accounting sees the real tier
    expect(escalation.state.calls).toBe(1);
  });

  test("the consensus key ignores free-text fields — same enums agree", async () => {
    const local = sequenceProvider([
      triage("billing", "high", "neutral", "Reply A — the modal one."),
      triage("billing", "high", "neutral", "A totally different draft B."),
      triage("billing", "high", "neutral", "Yet another draft C."),
      triage("billing", "high", "neutral", "Draft D."),
      triage("billing", "high", "neutral", "Draft E."),
    ]);
    const escalation = constantProvider(triage("other", "low", "neutral"), "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.6, consensusFields: CONSENSUS });

    const { result, routing } = await router.route(REQ, {
      local: local.provider,
      escalation: escalation.provider,
    });

    expect(routing.confidence).toBe(1); // agreement despite different drafts
    expect(routing.escalated).toBe(false);
    expect(result.text).toContain("Reply A"); // modal vote's full payload rides along
    expect(escalation.state.calls).toBe(0);
  });

  test("invalid votes dilute confidence against the N denominator", async () => {
    const local = sequenceProvider([
      triage("billing", "high", "neutral"),
      triage("billing", "high", "neutral"),
      "this is not JSON at all",
      "{}", // parses but missing the consensus fields → invalid
      "still not json",
    ]); // 2 valid identical of 5 → confidence 0.4, validSamples 2
    const escalation = constantProvider(triage("billing", "high", "neutral"), "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });

    const { routing } = await router.route(REQ, {
      local: local.provider,
      escalation: escalation.provider,
    });

    expect(routing.validSamples).toBe(2);
    expect(routing.confidence).toBeCloseTo(0.4, 5);
    expect(routing.escalated).toBe(true); // 0.4 < 0.5
  });

  test("samples is clamped to a floor of 1", () => {
    const router = new ConfidenceRouter({ samples: 0 });
    expect(router.config.samples).toBe(1);
  });
});

describe("GatewayService — routing path", () => {
  /** Resolve "ollama"→local, "bedrock"→escalation for the injected service. */
  function resolveFrom(local: ModelProvider, escalation: ModelProvider) {
    return (target: ProviderName): ModelProvider => (target === "bedrock" ? escalation : local);
  }

  const BENIGN: GenerateRequest = {
    system: "You are a customer-support triage assistant.",
    messages: [{ role: "user", content: "My invoice looks wrong — can you check it?" }],
  };

  test("output guardrails still wrap an escalated result", async () => {
    const local = sequenceProvider([
      triage("billing", "high", "neutral"),
      triage("technical", "low", "positive"),
      triage("account", "urgent", "negative"),
      triage("other", "medium", "neutral"),
      triage("billing", "low", "positive"),
    ]); // forces escalation
    const leak = `here is the key AKIA${"IOSFODNN7EXAMPLE"}`;
    const escalation = constantProvider(leak, "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });
    const svc = new GatewayService({
      resolveProvider: resolveFrom(local.provider, escalation.provider),
      router,
    });

    const res = await svc.generate("ollama", BENIGN);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violation.policy).toBe("secret-exfiltration");
      expect(res.violation.stage).toBe("output");
    }
  });

  test("surfaces the routing decision on a successful escalation", async () => {
    const local = sequenceProvider([
      triage("billing", "high", "neutral"),
      triage("technical", "low", "positive"),
      triage("account", "urgent", "negative"),
      triage("other", "medium", "neutral"),
      triage("billing", "low", "positive"),
    ]);
    const escalation = constantProvider(triage("technical", "high", "negative"), "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });
    const svc = new GatewayService({
      resolveProvider: resolveFrom(local.provider, escalation.provider),
      router,
    });

    const res = await svc.generate("ollama", BENIGN);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.routing?.escalated).toBe(true);
      expect(res.routing?.servedBy).toBe("bedrock");
      expect(res.result.provider).toBe("bedrock");
    }
  });

  test("a confident local call is served without escalation and carries routing", async () => {
    const vote = triage("billing", "high", "neutral");
    const local = sequenceProvider([vote, vote, vote, vote, vote]);
    const escalation = constantProvider(triage("other", "low", "neutral"), "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });
    const svc = new GatewayService({
      resolveProvider: resolveFrom(local.provider, escalation.provider),
      router,
    });

    const res = await svc.generate("ollama", BENIGN);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.routing?.escalated).toBe(false);
      expect(res.routing?.servedBy).toBe("ollama");
      expect(res.result.provider).toBe("ollama");
    }
    expect(escalation.state.calls).toBe(0);
  });

  test("blocks when the escalation tier's model is not allowlisted", async () => {
    const vote = triage("billing", "high", "neutral");
    const local = sequenceProvider([vote, vote, vote, vote, vote]); // would stay local...
    const escalation = constantProvider(vote, "bedrock");
    const router = new ConfidenceRouter({ samples: 5, threshold: 0.5, consensusFields: CONSENSUS });
    // Allow only the local model; the routing gateway must still refuse because
    // the frontier tier it could escalate to is not on the allowlist.
    const policy: GatewayPolicy = { allowedModels: ["ollama-test"], maxTokens: 4096 };
    const svc = new GatewayService({
      resolveProvider: resolveFrom(local.provider, escalation.provider),
      router,
      policy,
    });

    const res = await svc.generate("ollama", BENIGN);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.policy).toBe("model-allowlist");
    expect(local.state.calls).toBe(0); // refused up front, before sampling
  });
});

describe("resolveRouterFromEnv", () => {
  test("is undefined (off) when the enable flag is absent", () => {
    expect(resolveRouterFromEnv({})).toBeUndefined();
    expect(resolveRouterFromEnv({ RELIABILITY_ROUTER: "no" })).toBeUndefined();
  });

  test("reads the operating point from the environment", () => {
    const router = resolveRouterFromEnv({
      RELIABILITY_ROUTER: "1",
      RELIABILITY_ROUTER_SAMPLES: "3",
      RELIABILITY_ROUTER_THRESHOLD: "0.8",
      RELIABILITY_ROUTER_TEMPERATURE: "0.5",
      RELIABILITY_ROUTER_CONSENSUS_FIELDS: "category, priority",
    });
    expect(router).toBeDefined();
    expect(router?.config.samples).toBe(3);
    expect(router?.config.threshold).toBe(0.8);
    expect(router?.config.temperature).toBe(0.5);
    expect(router?.config.consensusFields).toEqual(["category", "priority"]);
    expect(router?.config.local).toBe("ollama"); // default retained
    expect(router?.config.escalateTo).toBe("bedrock");
  });
});
