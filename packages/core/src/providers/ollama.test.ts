// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

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
