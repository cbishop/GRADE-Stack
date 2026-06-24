# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** stub / stub-deterministic-v1  
**Generated:** 2026-06-24T18:11:06.798Z  
**Coverage:** 5 of 5 dimensions assessed — every dimension is now computed from evidence.

## Overall: 🟠 At risk

Not ready for unsupervised production use — the weakest dimension needs work.

| Dimension | Rating | Summary |
|---|---|---|
| Reliability | 🟢 Strong | The agent handles its task dependably across the test suite. |
| Cost discipline | 🟢 Strong | Almost every dollar spent produces a usable result. |
| Observability coverage | 🟢 Strong | Every step the agent takes is captured as one connected, inspectable trace. |
| Guardrail coverage | 🟠 At risk | Real guardrails exist, but coverage of the OWASP agentic threats is incomplete — known gaps remain. |
| Governance readiness | 🟡 Adequate | The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's. |

---

### Reliability — 🟢 Strong

The agent handles its task dependably across the test suite.

- 12 of 12 test cases passed (100%).
- Run-to-run stability 1.00 (1.00 = identical results each run).

### Cost discipline — 🟢 Strong

Almost every dollar spent produces a usable result.

- Cost per successful outcome: 402 tokens ($0 list cost).
- Total run cost $0 on stub/stub-deterministic-v1 — no per-token cost (self-hosted); the spend signal here is token volume.
- 0% of spend produced no passing result.

### Observability coverage — 🟢 Strong

Every step the agent takes is captured as one connected, inspectable trace.

- A full run produces one connected trace: 5 spans, single root, single trace id.
- Agent phases captured as spans: plan → execute → validate (3/3).
- Model calls traced with GenAI semantic conventions: 1.

### Guardrail coverage — 🟠 At risk

Real guardrails exist, but coverage of the OWASP agentic threats is incomplete — known gaps remain.

- Mapped against the OWASP Top 10 for Agentic Applications (2026, published 2025-12-09).
- 2 of 10 threats fully covered, 6 partial, 2 flagged as gaps (weighted coverage 50%).
- Explicit gaps to close before a fuller deployment: ASI06:2026, ASI07:2026.
- Partially covered: ASI01:2026, ASI02:2026, ASI04:2026, ASI08:2026, ASI09:2026, ASI10:2026.

### Governance readiness — 🟡 Adequate

The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's.

- Mapped against the EU Artificial Intelligence Act (Regulation (EU) 2024/1689), re-verified 2026-06-24.
- Readiness 75% over 6 stack-supportable deployer obligations (3 supported, 3 partial, 0 deployer-owned).
- In force now / from 2026-08-02: Art 5, Art 4, Art 50 (1)(4).
- Digital Omnibus: Provisional agreement reached by the European Parliament and Council on 2026-05-07; NOT yet formally adopted and NOT yet published in the Official Journal as of 2026-06-24.
- Governance readiness is not legal compliance — compliance is the deployer's.

---

_Every rating above is computed from the eval suite — no score is asserted without the evidence shown beneath it._
