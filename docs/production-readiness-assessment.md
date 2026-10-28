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

This was the **Phase 2 milestone deliverable**, updated for v3 Phase 4A. Every
one of the five GRADE letters is graded from evidence today; a few named
criteria inside them are not yet assessed and say which v3 sub-phase fills them
in (see [What this assessment does *not* yet cover](#what-this-assessment-does-not-yet-cover)).

---

## What you get: the five GRADE letters

The scorecard rates an agent on the five GRADE letters (ADR 0016). Each letter
holds named criteria. A criterion is either **computed** from a record, with the
source, the threshold applied, and what would change the grade, or **not yet
assessed**, with the v3 sub-phase that fills it in. A letter's grade is its
weakest computed criterion; the overall verdict is the weakest letter.

| Letter | Computed today, from | Not yet assessed (fills in) |
|---|---|---|
| **G · Governed** | Governance readiness: EU AI Act deployer module | Human oversight record (4D); Boundary register (4E) |
| **R · Reliable** | Reliability: eval pass rate + run-to-run stability. Cost discipline: cost-per-success + waste fraction | none |
| **A · Agentic** | Guardrail coverage: OWASP Agentic Top 10 mapping | Declared vs observed autonomy and tool scope (4E) |
| **D · Deployed** | Observability coverage: real OTel trace coverage (connected? phases captured?). Attributable and Reconstructable: the gateway decision log, when `--decision-log <file>` is given | Attributable and Reconstructable without a log (4B); Rollback verified (4C) |
| **E · Evaluated** | Suite breadth: case count, a refusal or OOD case, a judge metric | Last real-model run freshness; Judge calibration; Post-deployment re-score (4F) |

A criterion that is not yet assessed renders "Not yet assessed; fills in Phase
4X." It never asserts a score it can't back, and it never moves its letter's
grade.

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

The scorecard turns the eval evidence into the five-letter readout an executive
can read in three minutes. Every rating carries the evidence behind it — no
unsupported scores.

- `-f, --from eval-results.json` builds from an existing run instead of re-running
  the suite (faster, and lets you assess a captured result).
- The **Observability coverage** criterion (under D) is measured automatically here: the scorecard
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
PII redaction, token/model caps. The full OWASP mapping is in
[`governance/owasp/`](../governance/owasp/) and grades Guardrail coverage under A.)*

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

Read the **Overall verdict** (the weakest letter wins, and the headline names it;
a single failing letter means "not production-ready"), then each letter's
criteria. For each computed criterion that isn't **Strong**, the evidence lines
name the failing cases, the wasted spend, the missing trace coverage, or the
partial obligations to fix, and the "what would change the grade" line says what
moves it.

A reasonable bar for "ready for supervised production": **R · Reliable** and
**D · Deployed** at least *Adequate*, Cost discipline not *Critical*, the gateway
enforcing guardrails server-side, and a named owner for each criterion that is
not yet assessed (human oversight and rollback above all).

---

## What this assessment does *not* yet cover

Be explicit about the boundary — silent omissions are the credibility risk:

Every letter is graded, but these criteria are not yet assessed. Each is shown on
the scorecard with the sub-phase that fills it in:

- **Human oversight record** (G, 4D): no review queue holds an output for a named
  approver yet, so human-in-the-loop is the deployer's process. The EU AI Act
  Art 26 oversight obligation is rated *partial* for this reason.
- **Boundary register** (G, 4E) and **declared vs observed autonomy and tool
  scope** (A, 4E): policy is global today; per-agent limits are not declared or
  enforced.
- **Attributable and Reconstructable** (D, 4B): computed only when the client's
  gateway decision log is passed with `reliability scorecard --decision-log
  <file>`. Without it they stay not assessed. Read the log back with
  `reliability gateway log`. Reconstructable stays low until the client turns on
  content capture (`RELIABILITY_TRACE_CONTENT=1`) and states a retention period
  in `docs/logging-and-retention.md`.
- **Rollback verified** (D, 4C): there is no kill switch and no recorded drill.
- **Last real-model run freshness, judge calibration, post-deployment re-score**
  (E, 4F): the CI gate runs on the stub provider and the judge is not calibrated
  against human labels.

Treat each of these as "not assessed," not as "passed."

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

Open `scorecard.html`, read the overall verdict, and act on the weakest letter.
