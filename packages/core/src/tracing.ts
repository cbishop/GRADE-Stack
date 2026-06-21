// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/tracing
 *
 * The OpenTelemetry seam for the stack (Phase 2D). It owns three things:
 *
 *   1. **Instrumentation helpers** ({@link getTracer}, {@link withSpan},
 *      {@link traceProvider}) and the GenAI semantic-convention attribute keys —
 *      used by the agent path to emit a connected plan → tool → validation trace.
 *   2. **The export path** ({@link initTracing}) — opt-in (off by default); wires
 *      an OTLP exporter to a viewing backend (Phoenix by default; any OTLP
 *      endpoint, incl. Braintrust, via `OTEL_EXPORTER_OTLP_ENDPOINT`). See ADR 0008.
 *   3. **The measurement path** ({@link withInMemoryTracing},
 *      {@link summarizeTraceCoverage}) — a hermetic, network-free span capture the
 *      scorecard uses to compute the Observability dimension from real coverage.
 *
 * It deliberately does **not** decide *what* is instrumented (the agent/PEV/MCP
 * modules call these helpers) nor own any policy. When tracing is not active every
 * helper degrades to a no-op: instrumentation calls a no-op tracer, so the
 * deterministic CI eval gate and the air-gapped run (Phase 3D) are untouched.
 */

import {
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type TracerProvider,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { AgentPhase } from "./pev.ts";
import type { GenerateRequest, GenerateResult, ModelProvider, ProviderName } from "./types.ts";

export { SpanKind } from "@opentelemetry/api";

const TRACER_NAME = "@grade-stack/core";
const SERVICE_NAME = "grade-stack-agent";
const SERVICE_VERSION = "0.0.0";

/** Phoenix's default OTLP/HTTP traces endpoint — the documented viewing backend. */
const PHOENIX_DEFAULT_ENDPOINT = "http://localhost:6006/v1/traces";

/**
 * Env that turns the **export** path on. Off by default (Option A): tracing only
 * activates when this is truthy or an `OTEL_EXPORTER_OTLP_ENDPOINT` is set — so a
 * normal run, the CI gate, and an air-gapped run emit nothing unless asked.
 */
export const OTEL_ENABLE_ENV = "RELIABILITY_OTEL";

/**
 * GenAI semantic-convention attribute keys (OpenTelemetry GenAI conventions).
 * Defined here as string constants rather than imported so a churny incubating
 * package can't break the build; the names track the published convention.
 */
export const GENAI = {
  system: "gen_ai.system",
  operationName: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  requestTemperature: "gen_ai.request.temperature",
  requestMaxTokens: "gen_ai.request.max_tokens",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  agentName: "gen_ai.agent.name",
  toolName: "gen_ai.tool.name",
} as const;

/** Our own attribute marking which PEV phase a span belongs to (coverage signal). */
export const PHASE_ATTR = "grade_stack.phase";

/** Map a provider name to the GenAI `gen_ai.system` value. */
export function genAiSystem(provider: ProviderName): string {
  switch (provider) {
    case "bedrock":
      return "aws.bedrock";
    case "ollama":
      return "ollama";
    default:
      return provider;
  }
}

// ── tracer plumbing ─────────────────────────────────────────────────────────

// When set (by withInMemoryTracing), instrumentation draws its tracer from this
// provider instead of the global one — so the scorecard can measure coverage
// deterministically even when a global OTLP provider is also installed.
let providerOverride: TracerProvider | undefined;
let contextManagerEnabled = false;

/** Register the async-hooks context manager once, so spans nest by call stack. */
function ensureContextManager(): void {
  if (contextManagerEnabled) return;
  const cm = new AsyncLocalStorageContextManager();
  cm.enable();
  context.setGlobalContextManager(cm);
  contextManagerEnabled = true;
}

/**
 * The tracer all instrumentation uses. Resolves to the in-memory override (during
 * measurement), else the global provider — which is a no-op tracer when tracing
 * was never initialized, making every {@link withSpan} call a cheap pass-through.
 */
export function getTracer(): Tracer {
  const provider = providerOverride ?? trace.getTracerProvider();
  return provider.getTracer(TRACER_NAME);
}

export interface WithSpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Run `fn` inside an active span: sets OK/ERROR status, records exceptions, and
 * always ends the span. A no-op tracer still invokes `fn`, so this is safe to
 * call unconditionally on the hot path whether or not tracing is active.
 */
export function withSpan<T>(
  name: string,
  opts: WithSpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(
    name,
    { kind: opts.kind ?? SpanKind.INTERNAL, attributes: opts.attributes },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(err instanceof Error ? err : String(err));
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Wrap a {@link ModelProvider} so every `generate` call emits a GenAI `chat`
 * span with request/response model and token-usage attributes. The wrapper is
 * transparent (same name/model/result) and a no-op when tracing is off, so it
 * can wrap any provider — including the credential-free GatewayProvider — without
 * changing behavior.
 */
export function traceProvider(provider: ModelProvider): ModelProvider {
  return {
    name: provider.name,
    model: provider.model,
    generate(request: GenerateRequest): Promise<GenerateResult> {
      const attributes: Record<string, string | number | boolean> = {
        [GENAI.operationName]: "chat",
        [GENAI.system]: genAiSystem(provider.name),
        [GENAI.requestModel]: provider.model,
      };
      if (request.temperature !== undefined) {
        attributes[GENAI.requestTemperature] = request.temperature;
      }
      if (request.maxTokens !== undefined) {
        attributes[GENAI.requestMaxTokens] = request.maxTokens;
      }
      return withSpan(
        `chat ${provider.model}`,
        { kind: SpanKind.CLIENT, attributes },
        async (span) => {
          const result = await provider.generate(request);
          span.setAttributes({
            [GENAI.responseModel]: result.model,
            [GENAI.usageInputTokens]: result.usage.inputTokens,
            [GENAI.usageOutputTokens]: result.usage.outputTokens,
          });
          return result;
        },
      );
    },
  };
}

// ── export path (opt-in) ──────────────────────────────────────────────────────

/** True when the OTLP export path should activate (see {@link OTEL_ENABLE_ENV}). */
export function isTracingEnabled(): boolean {
  const flag = process.env[OTEL_ENABLE_ENV]?.toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return Boolean(endpoint && endpoint.length > 0);
}

/** A handle for the active export pipeline; `shutdown` flushes and tears down. */
export interface TracingHandle {
  enabled: boolean;
  /** The OTLP endpoint spans are exported to, when enabled. */
  endpoint?: string;
  shutdown(): Promise<void>;
}

let exportProvider: BasicTracerProvider | undefined;

function buildResource() {
  return resourceFromAttributes({
    "service.name": SERVICE_NAME,
    "service.version": SERVICE_VERSION,
  });
}

/**
 * Initialize the **export** pipeline (idempotent). When tracing is disabled this
 * is a no-op handle — nothing is registered, no network is touched. When enabled,
 * it lazily loads the OTLP/HTTP exporter and registers a global TracerProvider
 * exporting to the configured endpoint (Phoenix's default when only the flag is
 * set). Real model calls then show up as a connected trace in the backend.
 */
export async function initTracing(): Promise<TracingHandle> {
  if (!isTracingEnabled()) {
    return { enabled: false, async shutdown() {} };
  }
  if (exportProvider) {
    return { enabled: true, async shutdown() {} };
  }
  ensureContextManager();

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? undefined // let the exporter read the standard env (it appends /v1/traces)
    : PHOENIX_DEFAULT_ENDPOINT;

  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const exporter = new OTLPTraceExporter(endpoint ? { url: endpoint } : {});

  const provider = new BasicTracerProvider({
    resource: buildResource(),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  exportProvider = provider;

  return {
    enabled: true,
    endpoint: endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    async shutdown() {
      await provider.forceFlush();
      await provider.shutdown();
      exportProvider = undefined;
    },
  };
}

// ── measurement path (hermetic) ────────────────────────────────────────────────

/** A captured span, decoupled from the SDK's ReadableSpan so coverage is pure. */
export interface CapturedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
}

function toCaptured(span: ReadableSpan): CapturedSpan {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    attributes: { ...span.attributes },
  };
}

/**
 * Trace coverage of one agent run — the evidence behind the scorecard's
 * Observability dimension. A *connected* trace is one root and one trace id
 * spanning every span; phase coverage is how many of plan/execute/validate were
 * captured as spans.
 */
export interface TraceCoverage {
  totalSpans: number;
  rootSpans: number;
  distinctTraces: number;
  /** Exactly one root and one trace id over at least one span. */
  connected: boolean;
  /** Distinct PEV phases observed as spans. */
  observedPhases: AgentPhase[];
  missingPhases: AgentPhase[];
  /** observedPhases / 3, in [0,1]. */
  phaseCoverage: number;
  /** GenAI `chat` spans (model calls). */
  modelCallSpans: number;
  /** GenAI `execute_tool` spans (MCP tool calls). */
  toolCallSpans: number;
}

const ALL_PHASES: AgentPhase[] = ["plan", "execute", "validate"];

/** Compute {@link TraceCoverage} from captured spans. Pure — unit-testable. */
export function summarizeTraceCoverage(spans: CapturedSpan[]): TraceCoverage {
  const roots = spans.filter((s) => !s.parentSpanId);
  const traces = new Set(spans.map((s) => s.traceId));
  const observed = new Set<AgentPhase>();
  let modelCallSpans = 0;
  let toolCallSpans = 0;
  for (const s of spans) {
    const phase = s.attributes[PHASE_ATTR];
    if (phase === "plan" || phase === "execute" || phase === "validate") observed.add(phase);
    const op = s.attributes[GENAI.operationName];
    if (op === "chat") modelCallSpans += 1;
    if (op === "execute_tool") toolCallSpans += 1;
  }
  const observedPhases = ALL_PHASES.filter((p) => observed.has(p));
  const missingPhases = ALL_PHASES.filter((p) => !observed.has(p));
  return {
    totalSpans: spans.length,
    rootSpans: roots.length,
    distinctTraces: traces.size,
    connected: spans.length > 0 && roots.length === 1 && traces.size === 1,
    observedPhases,
    missingPhases,
    phaseCoverage: observedPhases.length / ALL_PHASES.length,
    modelCallSpans,
    toolCallSpans,
  };
}

/**
 * Run `fn` with an in-memory tracer installed, returning the captured spans and
 * their {@link TraceCoverage}. Network-free and deterministic: it never touches
 * the global OTLP provider, so the scorecard can measure observability coverage
 * offline (and air-gapped, Phase 3D) regardless of whether export is configured.
 */
export async function withInMemoryTracing<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; spans: CapturedSpan[]; coverage: TraceCoverage }> {
  ensureContextManager();
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    resource: buildResource(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const previous = providerOverride;
  providerOverride = provider;
  try {
    const result = await fn();
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans().map(toCaptured);
    return { result, spans, coverage: summarizeTraceCoverage(spans) };
  } finally {
    providerOverride = previous;
    await provider.shutdown();
  }
}

/** Render captured spans as an indented tree (for the `agent run --trace` view). */
export function formatSpanTree(spans: CapturedSpan[]): string {
  const children = new Map<string | undefined, CapturedSpan[]>();
  for (const s of spans) {
    const key = s.parentSpanId;
    const list = children.get(key) ?? [];
    list.push(s);
    children.set(key, list);
  }
  const lines: string[] = [];
  const walk = (parentId: string | undefined, depth: number): void => {
    for (const s of children.get(parentId) ?? []) {
      const op = s.attributes[GENAI.operationName];
      const tag = op ? ` (${String(op)})` : "";
      lines.push(`${"  ".repeat(depth)}• ${s.name}${tag}`);
      walk(s.spanId, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines.join("\n");
}
