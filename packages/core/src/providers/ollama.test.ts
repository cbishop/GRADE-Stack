// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/providers/ollama.test
 *
 * Tests for the Ollama provider over a stubbed transport — content/token
 * mapping, system-message handling, error paths — plus provider-name resolution.
 * Phase 4F: `maxTokens` reaches Ollama as `num_predict`, so a manifest token cap
 * bounds real output.
 */

import { describe, expect, test } from "bun:test";
import { resolveProviderName } from "../factory.ts";
import { OllamaProvider } from "./ollama.ts";

describe("OllamaProvider", () => {
  test("parses content and maps token usage from a stubbed transport", async () => {
    const stubFetch = (async () =>
      new Response(
        JSON.stringify({
          message: { content: "triaged: billing issue" },
          prompt_eval_count: 42,
          eval_count: 7,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "test-model", fetchFn: stubFetch });
    const result = await provider.generate({ messages: [{ role: "user", content: "hi" }] });

    expect(result.text).toBe("triaged: billing issue");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("test-model");
  });

  test("sends the system prompt as a leading system message", async () => {
    let captured: unknown;
    const stubFetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ fetchFn: stubFetch });
    await provider.generate({
      system: "You are a triage assistant.",
      messages: [{ role: "user", content: "help" }],
    });

    expect(captured).toMatchObject({
      messages: [
        { role: "system", content: "You are a triage assistant." },
        { role: "user", content: "help" },
      ],
    });
  });

  test("bite: maxTokens is passed as num_predict and bounds a reply longer than the cap", async () => {
    // A fake Ollama that honours num_predict the way the real server does:
    // generation stops after that many tokens (one word per token here).
    const natural = Array.from({ length: 60 }, (_, i) => `word${i}`);
    let sent: { options?: { num_predict?: number; temperature?: number } } = {};
    const fakeOllama = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      const cap = sent.options?.num_predict;
      const words = cap !== undefined && cap >= 0 ? natural.slice(0, cap) : natural;
      return new Response(
        JSON.stringify({
          message: { content: words.join(" ") },
          prompt_eval_count: 5,
          eval_count: words.length,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ fetchFn: fakeOllama });
    const capped = await provider.generate({
      messages: [{ role: "user", content: "write a long reply" }],
      maxTokens: 8,
    });
    expect(sent.options?.num_predict).toBe(8);
    expect(sent.options?.temperature).toBe(0);
    expect(capped.usage.outputTokens).toBe(8);
    expect(capped.text.split(" ").length).toBe(8);

    // No cap: the request leaves num_predict unset and the natural reply comes back.
    const free = await provider.generate({ messages: [{ role: "user", content: "again" }] });
    expect(sent.options && "num_predict" in sent.options).toBe(false);
    expect(free.usage.outputTokens).toBe(60);
  });

  test("throws on a non-OK response", async () => {
    const stubFetch = (async () =>
      new Response("nope", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch;

    const provider = new OllamaProvider({ fetchFn: stubFetch });
    await expect(
      provider.generate({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/Ollama request failed: 500/);
  });
});

describe("resolveProviderName", () => {
  test("honors an explicit provider name", () => {
    expect(resolveProviderName("bedrock")).toBe("bedrock");
    expect(resolveProviderName("ollama")).toBe("ollama");
  });

  test("throws on an unrecognized provider", () => {
    expect(() => resolveProviderName("gpt")).toThrow(/Unknown provider/);
  });
});
