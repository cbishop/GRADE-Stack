# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** stub / stub-deterministic-v1  
**Generated:** 2026-06-12T19:47:15.943Z  
**Coverage:** 2 of 5 dimensions assessed today — the rest are computed in later phases and shown as *not yet assessed*.

## Overall: 🟢 Strong

On the evidence available today, the agent looks production-ready.

| Dimension | Rating | Summary |
|---|---|---|
| Reliability | 🟢 Strong | The agent handles its task dependably across the test suite. |
| Cost discipline | 🟢 Strong | Almost every dollar spent produces a usable result. |
| Observability coverage | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 2D. |
| Guardrail coverage | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 3A. |
| Governance readiness | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 3C. |

---

### Reliability — 🟢 Strong

The agent handles its task dependably across the test suite.

- 12 of 12 test cases passed (100%).
- Run-to-run stability 1.00 (1.00 = identical results each run).

### Cost discipline — 🟢 Strong

Almost every dollar spent produces a usable result.

- Cost per successful outcome: 262 tokens ($0 list cost).
- Total run cost $0 on stub/stub-deterministic-v1 — no per-token cost (self-hosted); the spend signal here is token volume.
- 0% of spend produced no passing result.

### Observability coverage — ⚪ Not yet assessed

Not yet assessed — this dimension is computed in Phase 2D.

- Will be computed from real OpenTelemetry trace coverage (Phase 2D). No score is asserted until then.

### Guardrail coverage — ⚪ Not yet assessed

Not yet assessed — this dimension is computed in Phase 3A.

- Will be computed from the OWASP Agentic Top 10 mapping (Phase 3A). No score is asserted until then.

### Governance readiness — ⚪ Not yet assessed

Not yet assessed — this dimension is computed in Phase 3C.

- Will be computed from the EU AI Act deployer module (Phase 3C). No score is asserted until then.

---

_Every rating above is computed from the eval suite — no score is asserted without the evidence shown beneath it._
