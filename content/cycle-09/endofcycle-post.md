# Cycle 09 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**NIST AI RMF without the 100-page slog: I mapped the whole reference stack to all
19 categories of the framework — and the honest result is 8 supported, 6 partial,
5 deployer-owned.**

If a vendor tells you they're "NIST AI RMF aligned," ask them which of the 19
categories, and which side of the responsibility line each one sits on. Most can't
answer. Here's the answer for this stack, on one page.

NIST AI RMF 1.0 has four functions — **Govern, Map, Measure, Manage** — and 19
categories under them. It's an *organizational* framework, so the only honest way to
map a *software stack* to it is a shared-responsibility model:

- 🟢 **Supported (8)** — the stack ships a real capability for this. Strongest in
  **Measure**: config-as-code evals, the reliability scorecard, risk tracked
  against a committed baseline on every commit. And the *response* side of
  **Manage**: guardrails enforced at the gateway, the eval-gate that blocks
  regressions, bounded agent loops.
- 🟡 **Partial (6)** — the stack gives you inputs; you finish the work. Third-party/
  supply-chain controls (pinned dependencies, secret scanning, the OWASP supply-
  chain mapping) are real, but the *policy* around them is yours.
- ⚪ **Deployer-owned (5)** — your organization's control, not a stack defect.
  Accountability structures, workforce diversity processes, stakeholder engagement,
  societal-impact characterization. A stack claiming to "cover" these would be
  lying to you.

The breakdown by function tells the story at a glance: **Govern** is mostly yours
(0 supported, 2 partial, 4 deployer-owned); **Measure** is mostly the stack's
(3 supported, 1 partial, 0 deployer-owned). That's the shape you'd want from a
reliability tool — it does the technical measurement and risk-response, and it's
explicit that your governance *program* is still your program.

Two things keep this credible rather than marketing:

1. **It cites the exact version** — AI RMF 1.0 (NIST AI 100-1, Jan 2023),
   re-verified at build time, with the in-progress revision's status noted and the
   Generative AI Profile referenced as a companion.
2. **One honest caveat, stated up front:** NIST's "trustworthy characteristics"
   include fairness and privacy. The scorecard measures reliability, security, and
   transparency today; fairness and privacy are only partially exercised. The
   mapping says so rather than implying full coverage. A check in CI fails the build
   if any of the 19 categories is unclassified or the prose drifts from the data.

Mid-market reality: you don't need a 100-page program to start. You need to know,
per box, what's handled and what's on you. That's what this is. Mapping + machine-
readable version in the repo.
