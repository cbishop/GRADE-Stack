# Cycle 07 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

This cycle I'm adding **tracing** to the reference stack — and the surprise is how
different it is from the work I did last cycle, even though both are about
"knowing your agent is safe."

Guardrails (last cycle) **prevent** failures. Tracing **explains** them. You need
both, and teams that pick one usually pick wrong: they instrument nothing and
guard nothing, then debug production by re-reading the prompt and guessing.

What surprised me building it: the hard part isn't emitting spans, it's keeping
the instrumentation from leaking into everything else I care about.

- The agent has to stay **deterministic in CI** — the eval gate compares against a
  committed baseline, and a tracer that adds latency or a background network call
  is exactly the kind of nondeterminism that flakes a gate.
- The stack has a **sovereign / air-gapped** variant coming, and an observability
  layer that phones home to a cloud dashboard would quietly break the one promise
  that variant exists to make.

So the rule became: **tracing is off by default and on by one flag.** With nothing
set, no tracer is even registered — the instrumentation calls a no-op and the run
is byte-for-byte what it was before. Turn on one env var and the same run streams a
connected trace to a local viewer. The "must never run in CI / must never phone
home" property is structural, not a sticky note.

The other thing I'm leaning into: **vendor-neutral by construction.** I
instrument with OpenTelemetry's GenAI semantic conventions, so the backend is just
an endpoint. Local Phoenix by default; point the same run at Braintrust, Jaeger,
or whatever your team already pays for by changing one URL. No backend lock-in is
itself a mid-market feature.

Next post: the finished trace, and the scorecard line that's no longer a stub.
