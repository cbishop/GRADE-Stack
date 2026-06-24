# Cycle 10 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**What the EU AI Act actually requires of you in 2026 vs. 2027 — and why most
advice gets it wrong. I shipped a deployer readout, re-verified against the law as
it stands today, and lit up the scorecard's fifth and final dimension.**

Three mistakes I see in almost every "EU AI Act for business" post, and how the
readout avoids them:

**1. Quoting deferred deadlines as if they're law.** The Digital Omnibus — the
package that would push high-risk obligations to December 2027 — is at *provisional
agreement* (7 May 2026). It is **not yet adopted and not in the Official Journal.**
So its deferrals are **proposed, not law.** The honest guidance: **plan against 2
August 2026**; treat the delay as likely relief, not a deadline you can bank.

**2. Conflating the fines.** "€35M or 7%" is everywhere — but that cap is **only**
for Article 5 *prohibited* practices. Deployer-obligation breaches are **€15M or
3%**; misleading regulators is **€7.5M or 1%.** Three tiers, not one.

**3. Treating every AI system as high-risk.** Most mid-market agents aren't. A
customer-support triage agent is **not** an Annex III high-risk category. If that's
you, your near-term duties are small and concrete:

- **Don't deploy a prohibited practice** (Art 5 — already in force since Feb 2025).
- **Give your team AI literacy** (Art 4 — already in force).
- **Be transparent** (Art 50 — from 2 Aug 2026): tell people they're dealing with
  AI; disclose AI-generated content. A new Code of Practice (10 Jun 2026) is one
  route to show compliance.

Only **if** your agent is high-risk (hiring, credit, biometrics, essential
services…) do the heavy Art 26/27 duties — human oversight, logging, monitoring, a
fundamental-rights impact assessment — switch on.

**And the scorecard is now complete.** Governance readiness was the last stubbed
dimension; it's now computed from this readout:

```
Governance readiness — 🟡 Adequate
- Readiness 75% over 6 stack-supportable deployer obligations (3 supported, 3 partial).
- In force now / from 2026-08-02: Art 5, Art 4, Art 50.
- Digital Omnibus: provisional agreement (2026-05-07); not yet adopted — plan for 2026-08-02.
- Governance readiness is NOT legal compliance — compliance is the deployer's.
```

That last line is the whole point. The stack makes you genuinely **ready** on the
technical duties — human oversight (it's human-in-the-loop by design), record-
keeping (every run is a connected trace), monitoring (evals gate every change). It
does **not** make you compliant. FRIAs, registration, and choosing a lawful use
case stay yours. A tool that claimed otherwise would be selling you a liability.

Five dimensions, all computed from evidence, none stubbed — Reliability, Cost,
Observability, Guardrail coverage, Governance readiness. The overall verdict is
honestly **At risk**, driven by guardrail gaps against the OWASP agentic threats —
not by governance. That's the complete reference stack's self-assessment, and I'd
rather hand a board that than a green box.

Readout, machine-readable mapping, and the full sample scorecard are in the repo.
