# AI Reliability Scorecard

**Agent:** Support-email triage  
**Model:** ollama / gemma4:12b-mlx  
**Generated:** 2026-06-26T12:17:14.371Z  
**Coverage:** 5 of 5 dimensions assessed — every dimension is now computed from evidence.

## Overall: 🟡 Adequate

Workable, but with gaps a team should close before relying on it unsupervised. Weakest dimension: Reliability (Adequate).

| Dimension | Rating | Summary |
|---|---|---|
| Reliability | 🟡 Adequate | The agent usually succeeds, but a meaningful share of cases fail. |
| Cost discipline | 🟡 Adequate | Most spend is productive, but failures add a real tax to each success. |
| Observability coverage | 🟢 Strong | Every step the agent takes is captured as one connected, inspectable trace. |
| Guardrail coverage | 🟡 Adequate | Every applicable OWASP agentic threat has a mechanism, though several are only partly covered. |
| Governance readiness | 🟡 Adequate | The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's. |

---

### Reliability — 🟡 Adequate

The agent usually succeeds, but a meaningful share of cases fail.

- 10 of 12 test cases passed (83%).
- Run-to-run stability 1.00 (1.00 = identical results each run).
- Failing cases: billing-duplicate-charge, billing-late-fee-dispute.

### Cost discipline — 🟡 Adequate

Most spend is productive, but failures add a real tax to each success.

- Cost per successful outcome: 1582 tokens ($0 list cost).
- Total run cost $0 on ollama/gemma4:12b-mlx — no per-token cost (self-hosted); the spend signal here is token volume.
- 16% of spend produced no passing result.

### Observability coverage — 🟢 Strong

Every step the agent takes is captured as one connected, inspectable trace.

- A full run produces one connected trace: 5 spans, single root, single trace id.
- Agent phases captured as spans: plan → execute → validate (3/3).
- Model calls traced with GenAI semantic conventions: 1.

### Guardrail coverage — 🟡 Adequate

Every applicable OWASP agentic threat has a mechanism, though several are only partly covered.

- Mapped against the OWASP Top 10 for Agentic Applications (2026, published 2025-12-09).
- 8 of 10 threats apply to this architecture; of those, 2 fully covered, 6 partial, 0 unaddressed (weighted coverage 63%; bands: strong ≥90%, adequate ≥70%, at-risk ≥50%).
- Zero applicable threats are unaddressed — every applicable threat has a named mechanism.
- Partially covered (named residual gap each): ASI01:2026, ASI02:2026, ASI04:2026, ASI08:2026, ASI09:2026, ASI10:2026.
- Out of architectural scope — not deficiencies: ASI06:2026, ASI07:2026. These target capabilities a single-agent, stateless stack does not include; they become relevant only if a deployment adds them (e.g. persistent memory/RAG, multi-agent messaging).

### Governance readiness — 🟡 Adequate

The stack readies a deployer for the technical EU AI Act duties; the legal duties remain the deployer's.

- Mapped against the EU Artificial Intelligence Act (Regulation (EU) 2024/1689), re-verified 2026-06-24.
- Readiness 75% over 6 stack-supportable deployer obligations (3 supported, 3 partial, 0 deployer-owned).
- In force now / from 2026-08-02: Art 5, Art 4, Art 50 (1)(4).
- Digital Omnibus: Provisional agreement reached by the European Parliament and Council on 2026-05-07; NOT yet formally adopted and NOT yet published in the Official Journal as of 2026-06-24.
- Governance readiness is not legal compliance — compliance is the deployer's.

---

_Every rating above is computed from the eval suite — no score is asserted without the evidence shown beneath it._
