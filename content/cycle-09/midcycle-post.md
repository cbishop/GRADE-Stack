# Cycle 09 — Mid-cycle "working on / what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**This cycle I'm mapping the reference stack to the NIST AI Risk Management
Framework — and the most important decision was refusing to claim too much.**

Last cycle I mapped against the OWASP Agentic Top 10, where the vocabulary is
*covered / partial / gap* — it's a threat list, so "gap" is the honest word for a
threat you don't address. NIST AI RMF is a different animal. It's an
**organizational** framework: four functions — Govern, Map, Measure, Manage — and
most of GOVERN is about *policies, accountability structures, workforce processes*.
No software stack provides those. They're your company's job.

So if I'd reused "covered / gap" here, I'd have had two bad options: either claim
the stack "covers" organizational controls it obviously can't, or mark them all as
"gaps" — implying the stack is deficient where it was never meant to reach.

Both are dishonest. The fix is a **shared-responsibility model**, exactly like
cloud security: 🟢 *supported* (the stack ships a real capability for this), 🟡
*partial* (the stack gives you inputs, you finish the work), ⚪ *deployer-owned*
(this is your organization's control — a boundary, not a stack defect).

The early read is clarifying: the stack is strong on **Measure** (evals, scorecard,
baseline tracking — all in CI) and on the *response* side of **Manage** (gateway
guardrails, the eval-gate, bounded loops), and it honestly hands most of **Govern**
back to the deploying organization. That's not a weakness to hide — it's the answer
a procurement reviewer actually needs: *what does adopting this give me, and what's
still on me?*

Next post: the finished mapping, and why "we're NIST-aligned" is meaningless
without saying which 19 boxes you mean.
