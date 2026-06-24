# EU AI Act → deployer readout

What the **EU AI Act** (Regulation (EU) 2024/1689) actually requires of a
**mid-market company deploying an AI agent** — written so a CTO can act on the
basics without a lawyer. It separates **what's in force now** from **what's
deferred**, states the **Digital Omnibus's exact legal status**, and keeps the
**three penalty tiers distinct** (the most common mistake).

> **Not legal advice, and not a compliance certificate.** This readout identifies
> which obligations apply to a deployer and where the stack helps you be *ready*.
> Legal compliance is the deploying organization's responsibility.

Two forms, kept in lock-step by a CI check (`scripts/check-eu-ai-act.ts`, in
`bun run check`):

- **Machine-readable:** [`eu-ai-act-deployer-2026.json`](./eu-ai-act-deployer-2026.json) — the source of truth the scorecard's **Governance readiness** dimension is computed from.
- **Human-readable:** this file.

## Re-verified at build time (2026-06-24)

The plan's figures were checked months earlier; these were re-verified against the
law as it stands on the date above.

### Timeline — what's in force vs. what's coming

| Date | What | Status |
|---|---|---|
| 2024-08-01 | AI Act enters into force | done |
| 2025-02-02 | **Art 5 prohibited practices** + **Art 4 AI literacy** | **in force** |
| 2025-08-02 | GPAI obligations, governance bodies, penalties | **in force** |
| **2026-08-02** | **Art 50 transparency**; Annex III **high-risk** obligations (original date) | **applies now-ish — plan for it** |
| 2026-12-02 | (If Omnibus adopted) deferred high-risk duties; Art 50(2) generative grace | **proposed, not law** |
| 2027-12-02 / 2028-08-02 | (Plan-era / Omnibus) later high-risk & product-integrated dates | **proposed, not law** |

### Digital Omnibus — exact legal status

A **provisional agreement** was reached by the European Parliament and Council on
**2026-05-07**. As of **2026-06-24** it is **NOT yet formally adopted** and **NOT
yet published in the Official Journal**. **Its deferrals therefore have no legal
effect yet.** Plan against the dates currently in force (notably **2026-08-02**) and
treat the deferrals as *likely-but-not-guaranteed* relief — not as the operative
deadline.

> This refines the plan's earlier note ("agreed, pending OJ publication"): as of
> this build it is a *provisional* agreement, one step short of formal adoption.

### Penalty tiers — do not conflate

| Tier | Cap (whichever is **higher**) | Applies to |
|---|---|---|
| **Tier 1** | **€35M or 7%** of worldwide annual turnover | Art 5 **prohibited** practices (Art 99(3)) |
| **Tier 2** | **€15M or 3%** | Deployer (Art 26) & other operator obligations, incl. high-risk (Art 99(4)) |
| **Tier 3** | **€7.5M or 1%** | Incorrect/misleading info to authorities (Art 99(5)) |

SMEs/start-ups pay the **lower** of the fixed sum or the percentage. Only Art 5
carries the €35M/7% cap — most reporting that cites "€35M" for any violation is
wrong.

## What a mid-market deployer should actually do

**Most mid-market agents are limited-risk, not high-risk.** A customer-support
triage agent (this stack's reference task) is **not** an Annex III high-risk
category. For a limited-risk agent your near-term duties are small:

1. **Don't deploy a prohibited practice (Art 5).** Already illegal since Feb 2025.
   Decisive control is your *use case*, not your tooling.
2. **Give your team AI literacy (Art 4).** Already in force. Train the people who
   operate and oversee the agent.
3. **Be transparent (Art 50), from 2026-08-02.** Tell people when they're dealing
   with an AI, and disclose AI-generated content where required. A **Code of
   Practice on AI-generated-content transparency** (published 2026-06-10) is one
   route to demonstrate this.

**If your agent IS high-risk (Annex III — hiring, credit, biometrics, education,
essential services…):** the heavy Art 26 duties apply — human oversight, logging,
monitoring, and a fundamental-rights impact assessment (Art 27). Originally
2026-08-02; **likely deferred to 2026-12-02 if the Omnibus is adopted — but that's
not law yet, so plan for the earlier date.**

## How ready does this stack make you?

The Governance-readiness rating is computed over the **stack-supportable deployer
obligations** (weighted `supported=1.0`, `partial=0.5`). The pure-legal duties
(FRIA, conformity/registration) and provider-only duties (Art 50(2), GPAI) are
**listed but not scored** — no software makes them go away.

| Obligation | Applies | Stack readiness | Mechanism (or boundary) |
|---|---|---|---|
| Art 5 — avoid prohibited practices | in force | 🟡 Partial | Gateway guardrails (use-case call is yours) |
| Art 4 — AI literacy | in force | 🟡 Partial | Scorecard + docs as material (training is yours) |
| Art 50 — transparency | 2026-08-02 | 🟡 Partial | Structured output + human-reviewed drafts |
| Art 26 — human oversight (high-risk) | conditional | 🟢 Supported | PEV + human-in-loop + bounded turns |
| Art 26(6)/Art 12 — logs & record-keeping (high-risk) | conditional | 🟢 Supported | OpenTelemetry traces |
| Art 26 — monitoring & accuracy/robustness (high-risk) | conditional | 🟢 Supported | Eval-gate vs baseline + scorecard |
| Art 27 — FRIA (high-risk) | conditional | ⚪ Deployer-owned | Legal assessment (traces/scorecard are inputs) |
| Art 49 — registration / conformity | conditional | ⚪ Deployer-owned | Legal/administrative process |
| Art 50(2) — synthetic-content marking | provider-only | — | You rely on your model provider |
| Art 53 — GPAI provider duties | provider-only | — | On the foundation-model vendor |

**Readiness ≈ 0.75 → Adequate.** The honest reading: the stack makes you genuinely
ready on the *technical* obligations (oversight, logging, monitoring) and partially
on transparency/literacy; the *legal* duties (don't be prohibited, run a FRIA,
register) remain yours. Governance readiness ≠ legal compliance.

## Per-obligation detail

The authoritative detail — every obligation's owner, applicability, effective date,
penalty tier, named mechanism, and deferral note — lives in
[`eu-ai-act-deployer-2026.json`](./eu-ai-act-deployer-2026.json) so this document and
the scorecard cannot drift (the CI check enforces it).
