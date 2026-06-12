#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * The Bun-side bridge that the promptfoo custom provider shells out to. This is
 * the *only* path from the eval harness to a model, and it goes through the
 * `@grade-stack/core` provider abstraction — so promptfoo (which runs on Node)
 * never imports our Bun/TypeScript code directly, and the harness can never
 * fork its own model code path. Mirrors the 2C rule that the agent has one seam
 * to the model; here the eval harness has one too.
 *
 * Protocol: a single JSON request object on stdin, a single JSON response on
 * stdout. Two modes:
 *   - "agent":    run the reference agent over a SupportEmail.
 *   - "complete": one raw completion (used by the LLM-as-judge metric, so the
 *                 judge also flows through the provider abstraction and is
 *                 swappable to an Ollama judge — a hard Phase 3D prerequisite).
 */

import { createProvider, type GenerateResult } from "@grade-stack/core";
import { runReferenceAgent, type SupportEmail } from "reference-agent";

interface AgentRequest {
  mode: "agent";
  provider?: string;
  email: SupportEmail;
}

interface CompleteRequest {
  mode: "complete";
  provider?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

type BridgeRequest = AgentRequest | CompleteRequest;

interface BridgeResponse {
  output: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  providerName: string;
}

function toTokenUsage(result: GenerateResult): BridgeResponse["tokenUsage"] {
  const prompt = result.usage.inputTokens;
  const completion = result.usage.outputTokens;
  return { prompt, completion, total: prompt + completion };
}

async function handle(request: BridgeRequest): Promise<BridgeResponse> {
  const provider = createProvider(request.provider);

  if (request.mode === "agent") {
    const result = await runReferenceAgent(provider, request.email);
    return {
      output: result.raw,
      tokenUsage: {
        prompt: result.usage.inputTokens,
        completion: result.usage.outputTokens,
        total: result.usage.inputTokens + result.usage.outputTokens,
      },
      model: result.model,
      providerName: result.provider,
    };
  }

  // mode === "complete": a single raw call, used as the LLM judge.
  const result = await provider.generate({
    system: request.system,
    messages: [{ role: "user", content: request.prompt }],
    // Determinism pinned where the provider allows it (1A reproducibility).
    temperature: request.temperature ?? 0,
    maxTokens: request.maxTokens ?? 1024,
  });
  return {
    output: result.text,
    tokenUsage: toTokenUsage(result),
    model: result.model,
    providerName: result.provider,
  };
}

const raw = await Bun.stdin.text();
try {
  const request = JSON.parse(raw) as BridgeRequest;
  const response = await handle(request);
  process.stdout.write(JSON.stringify(response));
} catch (err) {
  process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
}
