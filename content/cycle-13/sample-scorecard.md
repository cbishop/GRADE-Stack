# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** ollama / gemma4:12b-mlx  
**Generated:** 2026-06-26T12:17:14.371Z  
**Coverage:** 5 of 5 GRADE letters graded from evidence; 6 criteria computed, 8 not yet assessed (each names the sub-phase that fills it in).

## Overall: 🟠 At risk

Not ready for unsupervised production use; the weakest dimension needs work. Weakest dimension: G · Governed (At risk). 8 criteria are not yet assessed; each names the sub-phase that fills it in.

| Letter | Rating | Computed | Not yet assessed | Summary |
|---|---|---|---|---|
| **G · Governed** | 🟠 At risk | 1 | Human oversight record (4D); Boundary register (4E) | The stack covers some EU AI Act readiness, but much remains the deployer's process or legal work. |
| **R · Reliable** | 🟡 Adequate | 2 | none | The agent usually succeeds, but a meaningful share of cases fail. |
| **A · Agentic** | 🟡 Adequate | 1 | Declared vs observed autonomy and tool scope (4E) | Every applicable OWASP agentic threat has a mechanism, though several are only partly covered. |
| **D · Deployed** | 🟢 Strong | 1 | Attributable and reconstructable (4B); Rollback verified (4C) | Every step the agent takes is captured as one connected, inspectable trace. |
| **E · Evaluated** | 🟢 Strong | 1 | Last real-model run freshness (4F); Judge calibration (4F); Post-deployment re-score (4F) | The suite has the basic breadth a pass rate needs: enough cases, a refusal or off-topic probe, and a judge metric. |

---

### G · Governed: 🟠 At risk

_Can you show who owns the agent, what it is allowed to do, and how those limits are enforced?_

#### Governance readiness: 🟠 At risk

The stack covers some EU AI Act readiness, but much remains the deployer's process or legal work.

- Mapped against the EU Artificial Intelligence Act (Regulation (EU) 2024/1689), re-verified 2026-06-24.
- Readiness 58% over 6 stack-supportable deployer obligations (1 supported, 5 partial, 0 deployer-owned).
- In force now / from 2026-08-02: Art 5, Art 4, Art 50 (1)(4).
- Digital Omnibus: Provisional agreement reached by the European Parliament and Council on 2026-05-07; NOT yet formally adopted and NOT yet published in the Official Journal as of 2026-06-24.
- Governance readiness is not legal compliance; compliance is the deployer's.
- **Source:** governance/eu-ai-act/eu-ai-act-deployer-2026.json (Regulation (EU) 2024/1689, re-verified 2026-06-24)
- **Threshold:** Weighted readiness over scored obligations (supported 1, partial 0.5, deployer-owned 0): Strong ≥90%, Adequate ≥70%, At risk ≥50%, else Critical.
- **What would change the grade:** Reaching Adequate needs readiness of at least 70%; each obligation moved from partial to supported by a shipped mechanism adds 8%.

#### Human oversight record: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4D.

- Will be computed from the review queue: low-confidence output held for a named approver, with approver and time recorded.

#### Boundary register: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4E.

- Will be computed from the per-agent manifests and boundary register (autonomy level, allowed tools and models, turn and token limits).

### R · Reliable: 🟡 Adequate

_Does the agent behave consistently, at a cost that buys results?_

#### Reliability: 🟡 Adequate

The agent usually succeeds, but a meaningful share of cases fail.

- 10 of 12 test cases passed (83%).
- Run-to-run stability 1.00 (1.00 = identical results each run).
- Failing cases: billing-duplicate-charge, billing-late-fee-dispute.
- **Source:** content/cycle-12/eval-run.json (ollama/gemma4:12b-mlx, run 2026-06-26T12:17:14.371Z): summary.passRate, summary.meanStability
- **Threshold:** Pass rate: Strong ≥90%, Adequate ≥75%, At risk ≥50%, else Critical; held back one band below 0.90 mean stability.
- **What would change the grade:** Reaching Strong needs a pass rate of at least 90%.

#### Cost discipline: 🟡 Adequate

Most spend is productive, but failures add a real tax to each success.

- Cost per successful outcome: 1582 tokens ($0 list cost).
- Total run cost $0 on ollama/gemma4:12b-mlx: no per-token cost (self-hosted); the spend signal here is token volume.
- 16% of spend produced no passing result.
- **Source:** content/cycle-12/eval-run.json (ollama/gemma4:12b-mlx, run 2026-06-26T12:17:14.371Z): per-case usage priced by @grade-stack/evals priceFor
- **Threshold:** Wasted spend: Strong <10%, Adequate <25%, At risk <50%, else Critical; Critical when no case passes.
- **What would change the grade:** Reaching Strong needs wasted spend under 10%.

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

- Will be computed from per-agent manifests enforced at the gateway and MCP server, compared with the calls the decision log observed.

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

#### Attributable and reconstructable: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4B.

- Will be computed from the gateway decision log: request id, caller id, policy fired, and input and output hashes per request.

#### Rollback verified: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4C.

- Will be computed from a dated kill-switch drill record and the release manifest that names the last good version.

### E · Evaluated: 🟢 Strong

_Is quality measured before and after every change, by a suite you can trust?_

#### Suite breadth: 🟢 Strong

The suite has the basic breadth a pass rate needs: enough cases, a refusal or off-topic probe, and a judge metric.

- 12 cases in the suite (meets the 10-case minimum).
- Refusal or out-of-distribution probe present: ood-off-topic.
- LLM-judge metric present: validate:judge.
- **Source:** content/cycle-12/eval-run.json (ollama/gemma4:12b-mlx, run 2026-06-26T12:17:14.371Z): cases[].id, cases[].trace[].checks[].metric
- **Threshold:** Three checks (10 or more cases; a refusal or out-of-distribution case; an LLM-judge metric), share met on the standard bands: all three Strong, two At risk, one or none Critical.
- **What would change the grade:** Drops if the suite falls below 10 cases or loses its refusal/OOD case or judge metric.

#### Last real-model run freshness: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4F.

- Will be computed from the nightly real-model eval job record (date, model, pass rate).

#### Judge calibration: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4F.

- Will be computed from judge-vs-human agreement on hand-labeled cases from `reliability eval calibrate`.

#### Post-deployment re-score: ⚪ Not yet assessed

Not yet assessed; fills in Phase 4F.

- Will be computed from captured production traces re-scored by `reliability eval run --from-traces`.

---

_A letter's grade is its weakest computed criterion; the overall verdict is the weakest letter. Every computed criterion cites the record it came from; every criterion without evidence says so and names the sub-phase that fills it in. No score is asserted without evidence._
