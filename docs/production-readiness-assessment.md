# Production-Readiness Assessment

A repeatable workflow for answering one question about an AI agent: **is it ready
to run in production, and where are the gaps?** It packages the Phase 1–2
capabilities of GRADE-Stack — evals, cost-per-success, the scorecard, the
planner/executor/validator architecture, the gateway, and tracing — into a single
runbook you can follow end to end.

It produces two artifacts:

1. **Structured eval results** (`eval-results.json`) — the machine-readable evidence.
2. **A one-page AI Reliability Scorecard** (Markdown + printable HTML) — the
   board-legible readout, every rating traced to that evidence.

This is the **Phase 2 milestone deliverable**. It assumes the stack is built
through Phase 2D; it does not require Phase 3 (two scorecard dimensions are
honestly stubbed until then — see [What this assessment does *not* yet cover](#what-this-assessment-does-not-yet-cover)).

---

## What you get: the five dimensions

The scorecard rates an agent on five executive dimensions. Three are **computed
from evidence** today; two are **honestly stubbed** until Phase 3.

| Dimension | Status today | Computed from | Phase |
|---|---|---|---|
| **Reliability** | ✅ computed | eval pass rate + run-to-run stability | 1A/1B |
| **Cost discipline** | ✅ computed | cost-per-success + waste fraction | 1B |
| **Observability coverage** | ✅ computed | real OTel trace coverage (connected? phases captured?) | 2D |
| **Guardrail coverage** | ⚪ stubbed | OWASP Agentic Top 10 mapping | 3A |
| **Governance readiness** | ⚪ stubbed | EU AI Act deployer module | 3C |

A stubbed dimension renders "not yet assessed" and names the phase that will
compute it — it never asserts a score it can't back.

---

## Prerequisites

- **Bun** installed; `bun install` run from a clean clone.
- **A model provider** for the agent under test:
  - `ollama` — local models (no cloud, no cost); or
  - `bedrock` — the production Claude path (needs AWS creds in the environment); or
  - `stub` — the deterministic, hermetic provider (use to dry-run the workflow
    offline — it exercises every step but is not a real model).
- **Optional but recommended for a real assessment:** the **gateway** running, so
  guardrails are enforced server-side on the agent's model calls
  (`reliability gateway serve` — see [ADR 0007](decisions/0007-gateway-policy-model-and-credential-isolation.md)).
  Set `RELIABILITY_GATEWAY=off` only for a quick local dry-run without it.

All commands below are run as `bun run reliability <…>` from the repo root.

---

## Step 1 — Run the eval suite (Reliability + Cost evidence)

```bash
bun run reliability eval run -p ollama -o eval-results.json
```

This runs the starter suite against the reference agent through the provider
abstraction and emits structured JSON: per-case pass/fail, the
plan→execute→validate trace, token usage, run-to-run **stability**, and
**cost-per-success** (tokens always; dollars on priced providers, `$0` with an
optional amortized rate on Ollama).

- Use `-J <provider>` to run the LLM-as-judge metrics on a different (e.g. local)
  model; `-j <n>` to set concurrency.
- **Regression gate:** `reliability eval gate` compares a run against the
  committed baseline within the tolerance band and **fails non-zero on
  regression**. This is what CI enforces on every PR; run it locally to confirm a
  change hasn't degraded the agent.
- **Honest-degradation check (optional):** re-run with `RELIABILITY_DEGRADED=1` (or
  `--degraded` on the scorecard) and confirm the numbers — and the scorecard —
  get *worse*. The degraded mode is a permanent canary, not a real failure.

## Step 2 — Generate the scorecard (the board readout)

```bash
bun run reliability scorecard -p ollama --format both -o scorecard
# writes scorecard.md and scorecard.html
```

The scorecard turns the eval evidence into the five-dimension readout an executive
can read in three minutes. Every rating carries the evidence behind it — no
unsupported scores.

- `-f, --from eval-results.json` builds from an existing run instead of re-running
  the suite (faster, and lets you assess a captured result).
- The **Observability** dimension is measured automatically here: the scorecard
  runs a hermetic, in-memory trace probe (network-free) to compute trace coverage,
  so it works offline regardless of whether you've wired an OTLP backend.

## Step 3 — Review the architecture, guardrail, and observability gaps

The scorecard tells you *where* to look; this step is *how* to inspect each.

**Architecture (planner/executor/validator).** Confirm the agent follows the
mid-market default shape and that its output contract is schema-enforced, not
prompted. See the reusable blueprint:
[`docs/blueprint-planner-executor-validator.md`](blueprint-planner-executor-validator.md).

**Guardrails (server-side, gateway).** Verify enforcement lives where the agent
can't switch it off:

```bash
bun run reliability gateway demo
```

This shows a guardrail violation blocked at the gateway **even under a
bypass-attempt prompt**, and a direct-to-provider call from the credential-isolated
agent process failing for lack of credentials (the structural proof). See
[ADR 0007](decisions/0007-gateway-policy-model-and-credential-isolation.md).
*(Scope today: prompt-injection/override denial, secret-exfiltration denial, output
PII redaction, token/model caps. The full OWASP mapping lands in Phase 3A.)*

**Observability (tracing).** Confirm a full run produces one **connected** trace —
plan → tool calls → validation:

```bash
bun run reliability agent run -p ollama --mcp --trace
```

`--trace` prints the captured span tree and a coverage line, with no backend
needed. To view traces in a UI, opt into OTLP export (Phoenix by default; any OTLP
endpoint incl. Braintrust via one env var) — see
[`docs/observability-tracing.md`](observability-tracing.md).

## Step 4 — Interpret and decide

Read the **Overall verdict** (the worst assessed dimension wins — a single failing
core dimension means "not production-ready"), then the per-dimension headlines and
evidence. For each dimension that isn't **Strong**, the evidence lines name the
failing cases, the wasted spend, or the missing trace coverage to fix.

A reasonable bar for "ready for supervised production": **Reliability** and
**Observability** at least *Adequate* and **Cost discipline** not *Critical*, with
the gateway enforcing guardrails server-side and a known plan for the two stubbed
governance dimensions.

---

## What this assessment does *not* yet cover

Be explicit about the boundary — silent omissions are the credibility risk:

- **Guardrail coverage** is not yet scored against a published threat taxonomy. The
  gateway enforces a concrete (but partial) guardrail set today; the
  covered-or-flagged mapping to the **OWASP Agentic Top 10** lands in **Phase 3A**,
  at which point this dimension is computed.
- **Governance readiness** (NIST AI RMF framing, **EU AI Act** deployer
  obligations) is not yet assessed; it is computed from the Phase 3C module.

Until then, treat those two dimensions as "not assessed," not as "passed."

---

## One-shot recap

```bash
bun install
bun run reliability eval run -p ollama -o eval-results.json   # evidence
bun run reliability eval gate                                  # regression check (CI parity)
bun run reliability scorecard -f eval-results.json --format both -o scorecard
bun run reliability gateway demo                               # guardrail enforcement proof
bun run reliability agent run -p ollama --mcp --trace          # connected-trace proof
```

Open `scorecard.html`, read the overall verdict, and act on the weakest dimension.
