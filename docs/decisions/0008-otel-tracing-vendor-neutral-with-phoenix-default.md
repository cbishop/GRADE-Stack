# ADR 0008 — OpenTelemetry tracing: vendor-neutral, Phoenix default, opt-in export

- **Status:** Accepted
- **Date:** 2026-06-20
- **Phase:** 2D (OpenTelemetry tracing)

## Context

Phase 2D requires instrumenting the full agent path with **OTel GenAI semantic
conventions**, exporting to an OTLP backend for viewing, and un-stubbing the
scorecard's **Observability coverage** dimension so it is computed from real trace
coverage. The acceptance contract is: a full run produces a **connected trace**
(plan → tool calls → validation), and the observability rating is evidence-backed.

Three constraints pull on the design:

1. **The CI eval gate must stay deterministic.** It runs against the hermetic
   `stub` provider and a committed baseline within a tolerance band (ADR 0003).
   Anything that adds nondeterminism, latency, or a network attempt to a normal
   run is a liability.
2. **The air-gapped variant (Phase 3D) must run with no cloud dependency.** The
   full pipeline (agent → evals → scorecard) has to complete with networking
   disabled, so the *default* run cannot depend on a hosted backend or phone home.
3. **The stack sells a vendor-neutral reference architecture.** The headline
   observability backend should be open and self-hostable, not a paid SaaS forks
   would inherit.

The backend choice (Phoenix vs Jaeger vs Braintrust vs file/console) and the
default export behavior were the two open questions.

## Decision

**Instrument vendor-neutrally; make the backend a swappable endpoint.** The agent
path is instrumented with pure OTel GenAI semantic-convention attributes
(`gen_ai.system`, `gen_ai.operation.name`, `gen_ai.request/response.model`,
`gen_ai.usage.*`, `gen_ai.tool.name`). Because the instrumentation targets the
convention, not a vendor, the backend is just an `OTEL_EXPORTER_OTLP_ENDPOINT`.

- **Default/demo backend: Arize Phoenix** (local, open-source, LLM-native trace
  UI, self-hostable → satisfies 3D). When only the enable flag is set, the
  exporter defaults to Phoenix's `http://localhost:6006/v1/traces`.
- **Braintrust (and any OTLP backend) is documented as a drop-in**: point
  `OTEL_EXPORTER_OTLP_ENDPOINT` at it. We did **not** make Braintrust the primary
  backend — it is cloud SaaS (conflicts with 3D), needs an API key by default, and
  overlaps the eval role already held by promptfoo (ADR 0002). Keeping it as a
  documented endpoint preserves the option without betting the default on cloud.

**Export is opt-in, off by default (Option A).** Tracing's export pipeline
(`initTracing`) only activates when `RELIABILITY_OTEL=1` or an
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. With neither, no SDK provider is registered,
so instrumentation calls a no-op tracer: zero added latency, zero network, zero
nondeterminism. The deterministic CI gate and the air-gapped run are therefore
untouched **by construction**, not by a "disable in CI" convention. We rejected
"on by default, no-op when no endpoint" because the OTLP exporter's natural
behavior on a missing endpoint is connect-and-retry-with-backoff — exactly the
stall/noise an air-gapped or CI run must not incur — and silencing it just
re-introduces a disable switch, i.e. Option A wearing a different default.

**Observability coverage is measured hermetically, separate from export.** The
scorecard never depends on a running backend: it measures coverage with an
in-memory span capture (`withInMemoryTracing`) over a deterministic `stub` run.
Trace coverage is a property of the *instrumented code path*, not of which model
answers, so the stub is sufficient and keeps the scorecard runnable offline (incl.
with `--from`). The dimension rates **connectedness** (one root, one trace id) and
**phase coverage** (plan/execute/validate captured as spans); MCP tool-call spans
are emitted when grounding runs but never penalize the rating, since MCP is
opt-in.

## Consequences

- **Positive:** Default runs, the CI gate, and air-gapped runs emit nothing unless
  asked — the determinism and sovereignty guarantees hold structurally. The
  viewing backend is a one-line endpoint swap (Phoenix, Jaeger, Braintrust, …).
  The scorecard's Observability rating is backed by a real captured trace and is
  reproducible offline.
- **Negative / accepted:** Traces are invisible until a reader opts in and starts
  a backend (documented in the gateway/tracing README and the cycle-07 post). The
  hermetic coverage probe runs an extra in-process `stub` agent invocation per
  scorecard — cheap and network-free.
- **Carried into 3D:** the same instrumentation runs air-gapped; with export off
  (the default) the pipeline has no cloud dependency, and a local Phoenix can view
  traces on-prem if desired.

## Alternatives considered

- **Braintrust as the primary backend** — best LLM UI if already in use, but cloud
  SaaS breaks the 3D air-gap story, needs credentials by default, and doubles the
  eval tooling. Kept as a documented OTLP endpoint instead.
- **Jaeger default** — trivially air-gapped and ubiquitous, but a generic
  non-LLM trace UI; Phoenix's GenAI-native view is the better demo for this stack.
- **File/console exporter only** — fully hermetic but no graphical trace view for
  the artifact; available via standard OTel env if wanted, not the default.
