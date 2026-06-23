# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** stub / stub-deterministic-v1  
**Generated:** 2026-06-23T13:38:15.461Z  
**Coverage:** 4 of 5 dimensions assessed today — the rest are computed in later phases and shown as *not yet assessed*.

## Overall: 🟠 At risk

Not ready for unsupervised production use — the weakest dimension needs work.

| Dimension | Rating | Summary |
|---|---|---|
| Reliability | 🟢 Strong | The agent handles its task dependably across the test suite. |
| Cost discipline | 🟢 Strong | Almost every dollar spent produces a usable result. |
| Observability coverage | 🟢 Strong | Every step the agent takes is captured as one connected, inspectable trace. |
| Guardrail coverage | 🟠 At risk | Real guardrails exist, but coverage of the OWASP agentic threats is incomplete — known gaps remain. |
| Governance readiness | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 3C. |

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

### Governance readiness — ⚪ Not yet assessed

Not yet assessed — this dimension is computed in Phase 3C.

- Will be computed from the EU AI Act deployer module (Phase 3C). No score is asserted until then.

---

_Every rating above is computed from the eval suite — no score is asserted without the evidence shown beneath it._
