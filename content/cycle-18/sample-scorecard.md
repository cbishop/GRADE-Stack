# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** stub / stub-deterministic-v1  
**Generated:** 2026-06-12T19:47:15.943Z  
**Coverage:** 5 of 5 GRADE letters graded from evidence; 9 criteria computed, 6 not yet assessed (each names the sub-phase that fills it in).

## Overall: 🔴 Critical

Not production-ready; a core dimension is failing. Weakest dimension: E · Evaluated (Critical). 6 criteria are not yet assessed; each names the sub-phase that fills it in.

| Letter | Rating | Computed | Not yet assessed | Summary |
|---|---|---|---|---|
| **G · Governed** | 🟡 Adequate | 1 | Human oversight record (4D); Boundary register (4E) | The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's. |
| **R · Reliable** | 🟢 Strong | 2 | none | The agent handles its task dependably across the test suite. |
| **A · Agentic** | 🟡 Adequate | 1 | Declared vs observed autonomy and tool scope (4E) | Every applicable OWASP agentic threat has a mechanism, though several are only partly covered. |
| **D · Deployed** | 🟢 Strong | 1 | Attributable (4B); Reconstructable (4B); Rollback verified (4C) | Every step the agent takes is captured as one connected, inspectable trace. |
| **E · Evaluated** | 🔴 Critical | 4 | none | The suite has not run on a real model in the record's window: its pass rate is a belief, not a measurement. |

---

### G · Governed: 🟡 Adequate

_Can you show who owns the agent, what it is allowed to do, and how those limits are enforced?_

#### Governance readiness: 🟡 Adequate

The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's.

- Mapped against the EU Artificial Intelligence Act (Regulation (EU) 2024/1689), re-verified 2026-06-24.
- Readiness 75% over 6 stack-supportable deployer obligations (3 supported, 3 partial, 0 deployer-owned).
- In force now / from 2026-08-02: Art 5, Art 4, Art 50 (1)(4).
- Digital Omnibus: Provisional agreement reached by the European Parliament and Council on 2026-05-07; NOT yet formally adopted and NOT yet published in the Official Journal as of 2026-06-24.
- Governance readiness is not legal compliance; compliance is the deployer's.
- **Source:** governance/eu-ai-act/eu-ai-act-deployer-2026.json (Regulation (EU) 2024/1689, re-verified 2026-06-24)
- **Threshold:** Weighted readiness over scored obligations (supported 1, partial 0.5, deployer-owned 0): Strong ≥90%, Adequate ≥70%, At risk ≥50%, else Critical.
- **What would change the grade:** Reaching Strong needs readiness of at least 90%; each obligation moved from partial to supported by a shipped mechanism adds 8%.

#### Human oversight record: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4D.

- Will be computed from the review queue (`--review-queue <file>`): low-confidence output held for a named approver, with approver and time recorded.

#### Boundary register: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4E.

- Will be computed from the per-agent manifests and boundary register (`--agents <dir>`): autonomy level, allowed tools and models, turn and token limits, owner.

### R · Reliable: 🟢 Strong

_Does the agent behave consistently, at a cost that buys results?_

#### Reliability: 🟢 Strong

The agent handles its task dependably across the test suite.

- 12 of 12 test cases passed (100%).
- Run-to-run stability 1.00 (1.00 = identical results each run).
- **Source:** packages/evals/baseline.stub.json (stub/stub-deterministic-v1, run 2026-06-12T19:47:15.943Z): summary.passRate, summary.meanStability
- **Threshold:** Pass rate: Strong ≥90%, Adequate ≥75%, At risk ≥50%, else Critical; held back one band below 0.90 mean stability.
- **What would change the grade:** Drops to Adequate below a 90% pass rate or below 0.90 stability.

#### Cost discipline: 🟢 Strong

Almost every dollar spent produces a usable result.

- Cost per successful outcome: 262 tokens ($0 list cost).
- Total run cost $0 on stub/stub-deterministic-v1: no per-token cost (self-hosted); the spend signal here is token volume.
- 0% of spend produced no passing result.
- **Source:** packages/evals/baseline.stub.json (stub/stub-deterministic-v1, run 2026-06-12T19:47:15.943Z): per-case usage priced by @grade-stack/evals priceFor
- **Threshold:** Wasted spend: Strong <10%, Adequate <25%, At risk <50%, else Critical; Critical when no case passes.
- **What would change the grade:** Drops to Adequate once 10% or more of spend buys no passing result.

### A · Agentic: 🟡 Adequate

_Does the agent have exactly the autonomy and tool access its job needs, and no more?_

#### Guardrail coverage: 🟡 Adequate

Every applicable OWASP agentic threat has a mechanism, though several are only partly covered.

- Mapped against the OWASP Top 10 for Agentic Applications (2026, published 2025-12-09).
- 8 of 10 threats apply to this architecture; of those, 2 fully covered, 6 partial, 0 unaddressed (weighted coverage 63%).
- Zero applicable threats are unaddressed: every applicable threat has a named mechanism.
- Partially covered (named residual gap each): ASI01:2026, ASI02:2026, ASI04:2026, ASI08:2026, ASI09:2026, ASI10:2026.
- Out of architectural scope, not deficiencies: ASI06:2026, ASI07:2026. These target capabilities a single-agent, stateless stack does not include; they become relevant only if a deployment adds them (e.g. persistent memory/RAG, multi-agent messaging).
- **Source:** governance/owasp/owasp-agentic-top10-2026.json (OWASP Top 10 for Agentic Applications 2026)
- **Threshold:** Weighted coverage of applicable threats (covered 1, partial 0.5, gap 0): Strong ≥90%, Adequate ≥70%, At risk ≥50%, else Critical; floored at Adequate when no applicable threat is unaddressed (ADR 0013).
- **What would change the grade:** Reaching Strong needs weighted coverage of at least 90%; each partial threat moved to covered adds 6%.

#### Declared vs observed autonomy and tool scope: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4E.

- Will be computed from per-agent manifests enforced at the gateway and MCP server (`--agents <dir> --decision-log <file>`), compared with the calls the decision log observed.

### D · Deployed: 🟢 Strong

_Can a team run it, see what it did, and undo a bad release?_

#### Observability coverage: 🟢 Strong

Every step the agent takes is captured as one connected, inspectable trace.

- A full run produces one connected trace: 5 spans, single root, single trace id.
- Agent phases captured as spans: plan → execute → validate (3/3).
- Model calls traced with GenAI semantic conventions: 1.
- **Source:** in-memory trace probe: one reference-agent run captured by `reliability scorecard`
- **Threshold:** Strong: one connected trace, 3/3 phases, at least one model-call span; Adequate: connected with at least 2/3 phases; At risk: fragmented; Critical: no spans.
- **What would change the grade:** Drops if the trace fragments or a phase stops being captured.

#### Attributable: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4B.

- Will be computed from the gateway decision log (`--decision-log <file>`): request id and caller id on every record.

#### Reconstructable: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4B.

- Will be computed from the gateway decision log (`--decision-log <file>`) with content capture on, and a retention period in the logging record.

#### Rollback verified: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4C.

- Will be computed from a dated kill-switch drill record (`--drills <dir>`) and the release manifest that names the last good version.

### E · Evaluated: 🔴 Critical

_Is quality measured before and after every change, by a suite you can trust?_

#### Suite breadth: 🟢 Strong

The suite has the basic breadth a pass rate needs: enough cases, a refusal or off-topic probe, and a judge metric.

- 12 cases in the suite (meets the 10-case minimum).
- Refusal or out-of-distribution probe present: ood-off-topic.
- LLM-judge metric present: validate:judge.
- **Source:** packages/evals/baseline.stub.json (stub/stub-deterministic-v1, run 2026-06-12T19:47:15.943Z): cases[].id, cases[].trace[].checks[].metric
- **Threshold:** Three checks (10 or more cases; a refusal or out-of-distribution case; an LLM-judge metric), share met on the standard bands: all three Strong, two At risk, one or none Critical.
- **What would change the grade:** Drops if the suite falls below 10 cases or loses its refusal/OOD case or judge metric.

#### Last real-model run freshness: 🔴 Critical

The suite has not run on a real model in the record's window: its pass rate is a belief, not a measurement.

- No real-model run recorded in docs/eval-record.md (generated 2026-10-30): the suite has only run on the stub.
- **Source:** docs/eval-record.md (lastRealModelRun: none)
- **Threshold:** Strong: a real-model run of the full suite (12 cases) within 30 days; Adequate: within 30 days but only part of the suite; At risk: 31 to 90 days old; Critical: older, or none recorded.
- **What would change the grade:** Rises when the nightly real-model job's results file is passed to `reliability eval record --results`.

#### Judge calibration: 🟠 At risk

Nobody has checked the judge against a human yet, so its verdicts are unverified.

- The calibration set packages/evals/calibration/labels.json is unlabeled: 20 judged assertion(s), 0 seeded with a judge verdict, 0 labeled by a person. No agreement is claimed.
- **Source:** docs/eval-record.md (calibration: packages/evals/calibration/labels.json)
- **Threshold:** Strong: agreement at least 80% and Cohen's kappa at least 0.6 over at least 10 labeled pairs; Critical: below either; At risk: unlabeled or fewer than 10 pairs. Re-judged from the numbers, not the record's status.
- **What would change the grade:** Rises when a person labels at least 10 seeded entries in packages/evals/calibration/labels.json and `reliability eval record` is re-run.

#### Post-deployment re-score: 🔴 Critical

Nothing shows the agent still meets the suite's bar in production.

- No production re-score recorded in docs/eval-record.md: no captured run has been re-scored with `reliability eval run --from-traces`.
- **Source:** docs/eval-record.md (lastRescore: none)
- **Threshold:** The worse of age (Strong within 30 days, At risk to 90, then Critical) and the re-scored pass rate (Strong at least 90%, Adequate 75%, At risk 50%, else Critical); none recorded is Critical.
- **What would change the grade:** Rises when a gateway capture directory (RELIABILITY_TRACE_CONTENT=1) is re-scored with `eval run --from-traces` and the result passed to `eval record`.

---

_A letter's grade is its weakest computed criterion; the overall verdict is the weakest letter. Every computed criterion cites the record it came from; every criterion without evidence says so and names the sub-phase that fills it in. No score is asserted without evidence._
