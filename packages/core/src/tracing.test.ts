// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/tracing.test
 *
 * Tests the OpenTelemetry seam (Phase 2D): the pure coverage summary over
 * synthetic spans, the hermetic in-memory capture (spans nest by call stack, one
 * connected trace), the GenAI `chat` span emitted by the provider wrapper, and
 * the env logic that keeps export off by default, and (Phase 4B, ADR 0017) the
 * identity attributes on root and `chat` spans plus opt-in content capture.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { StubProvider } from "./providers/stub.ts";
import {
  type CapturedSpan,
  formatSpanTree,
  GENAI,
  GENAI_CONTENT,
  genAiSystem,
  IDENTITY_ATTRS,
  identityAttributes,
  isContentCaptureEnabled,
  isTracingEnabled,
  OTEL_ENABLE_ENV,
  PHASE_ATTR,
  summarizeTraceCoverage,
  TRACE_CONTENT_ENV,
  traceProvider,
  withInMemoryTracing,
  withRequestSpan,
  withSpan,
} from "./tracing.ts";

function span(p: Partial<CapturedSpan>): CapturedSpan {
  return {
    name: p.name ?? "s",
    traceId: p.traceId ?? "t1",
    spanId: p.spanId ?? "s1",
    parentSpanId: p.parentSpanId,
    attributes: p.attributes ?? {},
  };
}

describe("summarizeTraceCoverage", () => {
  test("a connected full-path trace reports all phases and is connected", () => {
    const spans: CapturedSpan[] = [
      span({ spanId: "root", name: "agent.run" }),
      span({ spanId: "p", parentSpanId: "root", attributes: { [PHASE_ATTR]: "plan" } }),
      span({ spanId: "e", parentSpanId: "root", attributes: { [PHASE_ATTR]: "execute" } }),
      span({ spanId: "c", parentSpanId: "e", attributes: { [GENAI.operationName]: "chat" } }),
      span({ spanId: "v", parentSpanId: "root", attributes: { [PHASE_ATTR]: "validate" } }),
    ];
    const cov = summarizeTraceCoverage(spans);
    expect(cov.connected).toBe(true);
    expect(cov.rootSpans).toBe(1);
    expect(cov.distinctTraces).toBe(1);
    expect(cov.observedPhases).toEqual(["plan", "execute", "validate"]);
    expect(cov.missingPhases).toEqual([]);
    expect(cov.phaseCoverage).toBe(1);
    expect(cov.modelCallSpans).toBe(1);
  });

  test("two roots or two trace ids are not connected", () => {
    const twoRoots = summarizeTraceCoverage([span({ spanId: "a" }), span({ spanId: "b" })]);
    expect(twoRoots.connected).toBe(false);
    expect(twoRoots.rootSpans).toBe(2);

    const twoTraces = summarizeTraceCoverage([
      span({ spanId: "a", traceId: "t1" }),
      span({ spanId: "b", parentSpanId: "a", traceId: "t2" }),
    ]);
    expect(twoTraces.connected).toBe(false);
    expect(twoTraces.distinctTraces).toBe(2);
  });

  test("empty trace is not connected and reports every phase missing", () => {
    const cov = summarizeTraceCoverage([]);
    expect(cov.connected).toBe(false);
    expect(cov.totalSpans).toBe(0);
    expect(cov.missingPhases).toEqual(["plan", "execute", "validate"]);
    expect(cov.phaseCoverage).toBe(0);
  });

  test("counts tool-call spans separately from model calls", () => {
    const cov = summarizeTraceCoverage([
      span({ spanId: "root", name: "agent.run" }),
      span({
        spanId: "t",
        parentSpanId: "root",
        attributes: { [GENAI.operationName]: "execute_tool" },
      }),
      span({ spanId: "c", parentSpanId: "root", attributes: { [GENAI.operationName]: "chat" } }),
    ]);
    expect(cov.toolCallSpans).toBe(1);
    expect(cov.modelCallSpans).toBe(1);
  });
});

describe("withInMemoryTracing", () => {
  test("captures nested spans as one connected trace", async () => {
    const { spans, coverage } = await withInMemoryTracing(async () => {
      await withSpan("root", { attributes: { [PHASE_ATTR]: "plan" } }, async () => {
        await withSpan("child", { attributes: { [PHASE_ATTR]: "execute" } }, async () => {});
      });
    });
    expect(coverage.connected).toBe(true);
    const root = spans.find((s) => s.name === "root");
    const child = spans.find((s) => s.name === "child");
    expect(child?.parentSpanId).toBe(root?.spanId);
    expect(root?.parentSpanId).toBeUndefined();
  });

  test("traceProvider emits a GenAI chat span with model + usage attributes", async () => {
    const { spans } = await withInMemoryTracing(async () => {
      const provider = traceProvider(new StubProvider());
      await provider.generate({
        system: "you are a triage assistant",
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 10,
        temperature: 0,
      });
    });
    const chat = spans.find((s) => s.attributes[GENAI.operationName] === "chat");
    expect(chat).toBeDefined();
    expect(chat?.attributes[GENAI.requestModel]).toBe("stub-deterministic-v1");
    expect(chat?.attributes[GENAI.system]).toBe("stub");
    expect(Number(chat?.attributes[GENAI.usageOutputTokens])).toBeGreaterThan(0);
  });

  test("a span that throws still ends and propagates", async () => {
    await expect(
      withInMemoryTracing(async () => {
        await withSpan("boom", {}, async () => {
          throw new Error("kaboom");
        });
      }),
    ).rejects.toThrow("kaboom");
  });
});

describe("isTracingEnabled (off by default)", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env[OTEL_ENABLE_ENV] = prev[OTEL_ENABLE_ENV];
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  test("disabled when neither the flag nor an endpoint is set", () => {
    delete process.env[OTEL_ENABLE_ENV];
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(isTracingEnabled()).toBe(false);
  });

  test("enabled by the flag, or by an OTLP endpoint, and force-off by 0", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env[OTEL_ENABLE_ENV] = "1";
    expect(isTracingEnabled()).toBe(true);

    delete process.env[OTEL_ENABLE_ENV];
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    expect(isTracingEnabled()).toBe(true);

    process.env[OTEL_ENABLE_ENV] = "0";
    expect(isTracingEnabled()).toBe(false);
  });
});

describe("request identity on spans (4B)", () => {
  const request = {
    system: "you are a triage assistant",
    messages: [{ role: "user" as const, content: "my invoice is wrong" }],
  };

  test("identityAttributes: request id always; caller id and enduser.id only when supplied", () => {
    expect(identityAttributes({ requestId: "r1", callerId: "triage" })).toEqual({
      [IDENTITY_ATTRS.requestId]: "r1",
      [IDENTITY_ATTRS.callerId]: "triage",
      [IDENTITY_ATTRS.endUser]: "triage",
    });
    expect(identityAttributes({ requestId: "r1" })).toEqual({ [IDENTITY_ATTRS.requestId]: "r1" });
    expect(IDENTITY_ATTRS).toEqual({
      requestId: "grade_stack.request_id",
      callerId: "grade_stack.caller_id",
      endUser: "enduser.id",
    });
  });

  test("the root request span and the chat span both carry the identity", async () => {
    const identity = { requestId: "r1", callerId: "triage" };
    const { spans } = await withInMemoryTracing(() =>
      withRequestSpan("gateway.generate", identity, () =>
        traceProvider(new StubProvider(), { identity }).generate(request),
      ),
    );
    expect(spans.length).toBe(2);
    for (const s of spans) {
      expect(s.attributes[IDENTITY_ATTRS.requestId]).toBe("r1");
      expect(s.attributes[IDENTITY_ATTRS.endUser]).toBe("triage");
    }
  });

  test("content is off by default and recorded on chat spans only when opted in", async () => {
    const prev = process.env[TRACE_CONTENT_ENV];
    try {
      delete process.env[TRACE_CONTENT_ENV];
      expect(isContentCaptureEnabled()).toBe(false);
      const off = await withInMemoryTracing(() =>
        traceProvider(new StubProvider()).generate(request),
      );
      for (const s of off.spans) {
        expect(s.attributes[GENAI_CONTENT.input]).toBeUndefined();
        expect(s.attributes[GENAI_CONTENT.output]).toBeUndefined();
        expect(JSON.stringify(s.attributes)).not.toContain("invoice");
      }

      process.env[TRACE_CONTENT_ENV] = "1";
      expect(isContentCaptureEnabled()).toBe(true);
      const on = await withInMemoryTracing(() =>
        traceProvider(new StubProvider()).generate(request),
      );
      const chat = on.spans[0];
      expect(String(chat?.attributes[GENAI_CONTENT.input])).toContain("my invoice is wrong");
      expect(String(chat?.attributes[GENAI_CONTENT.output])).toContain("billing");
    } finally {
      if (prev === undefined) delete process.env[TRACE_CONTENT_ENV];
      else process.env[TRACE_CONTENT_ENV] = prev;
    }
  });
});

describe("helpers", () => {
  test("genAiSystem maps provider names to GenAI systems", () => {
    expect(genAiSystem("bedrock")).toBe("aws.bedrock");
    expect(genAiSystem("ollama")).toBe("ollama");
    expect(genAiSystem("stub")).toBe("stub");
  });

  test("formatSpanTree renders parent/child indentation", () => {
    const tree = formatSpanTree([
      span({ spanId: "root", name: "agent.run" }),
      span({ spanId: "c", parentSpanId: "root", name: "agent.plan" }),
    ]);
    expect(tree).toContain("• agent.run");
    expect(tree).toContain("  • agent.plan");
  });
});
