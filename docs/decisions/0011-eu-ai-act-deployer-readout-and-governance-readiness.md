# ADR 0011 — EU AI Act deployer readout: build-time re-verification, readiness ≠ compliance, last scorecard dimension

- **Status:** Accepted
- **Date:** 2026-06-24
- **Phase:** 3C (EU AI Act deployer readout)

## Context

Phase 3C is the governance phase's credibility test: produce a precise **deployer**
readout of the EU AI Act that **distinguishes what applies now from what's
deferred**, **states the Digital Omnibus's exact legal status**, gets the penalty
tiers right, and **un-stubs the scorecard's last dimension — Governance readiness**.
The plan flagged that its own figures were checked months earlier and would have
moved, mandating **build-time re-verification**.

Three decisions: what the law actually says today; how a scorecard dimension can
rate "governance" honestly when compliance is fundamentally the deployer's; and how
to keep the readout from silently going stale.

## Decision

### 1. Re-verified at build time (2026-06-24) and pinned

Verified against current sources rather than the plan's older notes:

- **In force:** Art 5 prohibited practices + Art 4 AI literacy (2025-02-02); GPAI,
  governance, penalties (2025-08-02).
- **2026-08-02:** Article 50 transparency; Annex III high-risk (original date).
- **Digital Omnibus:** a **provisional agreement reached 2026-05-07**, **not yet
  formally adopted / not in the Official Journal** as of build time — so its
  deferrals (high-risk → 2026-12-02, product-integrated → 2028-08-02, Art 50(2)
  generative grace → 2026-12-02) are **proposed, not law**. The readout instructs a
  deployer to plan against 2026-08-02 and treat the deferrals as likely-but-not-
  guaranteed. This **refines the plan's earlier "agreed, pending OJ" note** — it is
  one step short of that (provisional, pre-adoption).
- **Penalty tiers kept distinct:** €35M/7% (Art 5 only), €15M/3% (Art 26 deployer &
  other obligations), €7.5M/1% (misleading info). Conflation is the most common
  error and is explicitly guarded against.
- A **Code of Practice on AI-generated-content transparency** (published
  2026-06-10) is noted as a compliance route for Art 50.

### 2. Governance readiness rates the stack's *readiness contribution*, not compliance

EU AI Act compliance is the deploying organization's legal responsibility; no stack
makes a deployer compliant. So the dimension measures **how ready the stack makes a
deployer** for the **stack-supportable deployer obligations**, weighting
`supported=1.0 / partial=0.5 / deployer-owned=0.0` and banding the mean
(strong ≥0.9, adequate ≥0.7, at-risk ≥0.5, critical <0.5). Pure-legal duties (FRIA,
conformity, registration) and provider-only duties (Art 50(2), GPAI) are **listed
but `scored: false`** — scoring a tool on "did you do your legal paperwork" is
meaningless, and including them would dishonestly drag the rating. Every readiness
evidence line states **"governance readiness is not legal compliance."** The honest
result for the reference (limited-risk) deployment is **0.75 → Adequate**: ready on
the technical duties (oversight, logging, monitoring), partial on transparency/
literacy, with the legal duties named as the deployer's.

With this, **all five scorecard dimensions are now computed from evidence** — none
stubbed. The overall verdict stays **At risk**, driven by Guardrail coverage (3A),
not governance.

### 3. Honesty + freshness enforced by a check

`scripts/check-eu-ai-act.ts` (reusing the scorecard's `parseEuAiActModule` Zod
schema) fails the build when an obligation lacks its fields, a scored supported/
partial obligation names no mechanism, the three penalty tiers are not intact, or
the README drops a credibility-critical fact (regulation id, "Digital Omnibus",
2026-08-02, the three penalty caps, the readiness≠compliance caveat). Wired into
`bun run check` + CI.

## Consequences

- The scorecard is complete: five evidence-backed dimensions, the Phase 3 gate met.
- **Re-verification is a standing duty.** This readout is correct as of 2026-06-24;
  the Omnibus's adoption status and the 2026-08-02 / 2026-12-02 dates must be
  re-checked at each build boundary. The `retrievedAt` field records when they last
  were, and the check guards the facts' presence but cannot verify their *currency*
  — that remains a human re-verification task before external publication.
- The `supported/partial/deployer-owned` model (from NIST 3B / ADR 0010) carried
  over cleanly, confirming it as the house style for governance mappings.

## Alternatives considered

- **Score all obligations (incl. pure-legal).** Rejected — drags the rating with
  duties no tool can satisfy, mislabelling a responsibility boundary as a failure.
- **Claim the stack makes a deployer "compliant."** Rejected outright — false and a
  liability; the dimension and readout repeatedly say readiness ≠ compliance.
- **Encode the Omnibus's deferred dates as the operative deadlines.** Rejected —
  they are not yet law; a deployer must plan against 2026-08-02.
