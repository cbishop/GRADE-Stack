# Observability — OpenTelemetry tracing (Phase 2D)

How the reference stack is traced, how to view the traces, and why export is off
by default. Decision record: [ADR 0008](decisions/0008-otel-tracing-vendor-neutral-with-phoenix-default.md).

## What gets traced

A full agent run emits one **connected trace** using the OpenTelemetry **GenAI
semantic conventions**. The span tree (with MCP grounding on):

```
• agent.run                 (gen_ai.operation.name=invoke_agent, gen_ai.agent.name=reference-agent)
  • mcp.ground
    • chat <model>           (gen_ai.operation.name=chat, gen_ai.usage.*)
    • execute_tool <name>    (gen_ai.operation.name=execute_tool, gen_ai.tool.name)
  • agent.plan               (grade_stack.phase=plan)
  • agent.execute            (grade_stack.phase=execute)
    • chat <model>           (gen_ai.operation.name=chat, gen_ai.request/response.model, gen_ai.usage.*)
  • agent.validate           (grade_stack.phase=validate, grade_stack.valid)
```

Every model call (tool selection **and** the PEV executor) is a `chat` span,
because the agent wraps its provider with `traceProvider` from `@grade-stack/core`
— so instrumentation is one seam, not scattered call sites. The wrapper is
transparent and a no-op when tracing is off.

## Seeing the connected trace (no backend needed)

```bash
reliability agent run -p ollama --mcp --trace
```

`--trace` captures the run's spans **in memory** and prints the tree plus a
coverage line (`connected`, span count, phases, model/tool calls). This needs no
collector — it's the quickest way to verify the trace is connected.

## Viewing in a backend (opt-in)

Tracing export is **off by default** (ADR 0008, Option A). Turn it on with an env
flag or an OTLP endpoint; with neither set, nothing is registered and no network
is touched — keeping the CI eval gate deterministic and the air-gapped run clean.

**Phoenix (default, local, open-source):**

```bash
# 1. start Phoenix (listens on :6006 for OTLP/HTTP)
#    e.g.  pip install arize-phoenix && phoenix serve
# 2. run with export on — defaults to http://localhost:6006/v1/traces
RELIABILITY_OTEL=1 reliability agent run -p ollama --mcp
# open http://localhost:6006 to view the trace
```

**Any other OTLP backend (incl. Braintrust):** point the standard env var at it.

```bash
# Braintrust (or Jaeger, Tempo, an OTel Collector, …)
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.braintrust.dev/otel
# plus whatever auth headers that backend needs, e.g.:
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer $BRAINTRUST_API_KEY, x-bt-parent=project_id:<id>"
reliability agent run -p ollama --mcp
```

Because instrumentation is vendor-neutral GenAI semconv, the backend is just an
endpoint — no code change to switch.

## How the scorecard uses it

The scorecard's **Observability coverage** dimension is computed from real trace
coverage, measured hermetically (in-memory, network-free) over a deterministic
`stub` run — so the scorecard stays runnable offline. The rating reflects whether
a run is **connected** (one root, one trace id) and how many of plan/execute/
validate are captured as spans. MCP tool-call spans appear when grounding runs but
never penalize the rating (MCP is opt-in).

## Env reference

| Variable | Effect |
|---|---|
| `RELIABILITY_OTEL=1` | Turn on OTLP export (defaults endpoint to Phoenix). `0` forces off. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Export to this OTLP/HTTP endpoint (also turns export on). |
| `--trace` (on `agent run`) | In-memory capture + printed span tree; no backend, no export. |
