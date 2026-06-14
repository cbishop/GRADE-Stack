# AI Reliability Scorecard

> ⚠️ **Degraded run** — the agent was deliberately worsened for this scorecard.

**Agent:** Support-email triage  
**Model:** stub / stub-deterministic-v1  
**Generated:** 2026-06-13T13:14:17.307Z  
**Coverage:** 2 of 5 dimensions assessed today — the rest are computed in later phases and shown as *not yet assessed*.

## Overall: 🔴 Critical

Not production-ready — a core dimension is failing.

| Dimension | Rating | Summary |
|---|---|---|
| Reliability | 🔴 Critical | The agent fails the majority of cases — not fit for production. |
| Cost discipline | 🔴 Critical | Spend is mostly wasted — there is little or no successful output to pay for. |
| Observability coverage | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 2D. |
| Guardrail coverage | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 3A. |
| Governance readiness | ⚪ Not yet assessed | Not yet assessed — this dimension is computed in Phase 3C. |

---

### Reliability — 🔴 Critical

The agent fails the majority of cases — not fit for production.

- 0 of 12 test cases passed (0%).
- Run-to-run stability 1.00 (1.00 = identical results each run).
- Failing cases: billing-duplicate-charge, technical-login-loop, account-cancellation, billing-late-fee-dispute, +8 more.

### Cost discipline — 🔴 Critical

Spend is mostly wasted — there is little or no successful output to pay for.

- Cost per successful outcome: undefined (no case passed).
- Total run cost $0 on stub/stub-deterministic-v1 — no per-token cost (self-hosted); the spend signal here is token volume.
- 100% of spend produced no passing result.

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

