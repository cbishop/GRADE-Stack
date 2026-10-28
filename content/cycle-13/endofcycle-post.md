# Cycle 13: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**The scorecard now admits what it cannot grade yet. Its overall rating went
down, from Adequate to At risk, and the stack did not change. The honesty did.**

GRADE stands for Governed, Reliable, Agentic, Deployed, Evaluated. My scorecard
was named for those five letters but graded five other things: reliability, cost,
observability, guardrails, governance readiness. An audit against a four-part
assurance loop (trusted evals, traceability, rollback, a human review queue)
made the mismatch hard to ignore. So this cycle I fixed it.

What changed:

**1. Two governance ratings were overclaims, so I downgraded them.** My EU AI Act
mapping rated human oversight "supported" because the agent drafts replies a
human sends. No code makes a human send anything. It also rated logging
"supported" and called the traces durable. They are opt-in, carry no caller id,
and the gateway records none of its decisions. Both now read "partial", with a
named residual and the sub-phase that fixes each. NIST MEASURE 3 and MANAGE 4
got the same treatment. Governance readiness fell from 75% to 58%.

**2. The scorecard is now graded by letter.** Each letter holds named criteria.
Every criterion is in one of two states: computed from a record, with the source
file, the threshold, and what would change the grade; or not yet assessed, with
the sub-phase that fills it in. A test fails if a third state ever appears.
Eight criteria are stubs today: the human oversight record, rollback, attributable
logs, judge calibration, and others. They show on the page instead of hiding.

**3. A letter's grade is its weakest computed criterion.** Stubs never raise or
lower it. The overall verdict is the weakest letter, and it names the letter.
Today that is G, Governed, at At risk.

The point I keep coming back to: a rating with nothing behind it is worse than
no rating. A reviewer at a bank asks "show me" before anything else. Now every
line on the page either shows the record or says plainly that the record does
not exist yet and when it will.

The next five sub-phases each turn one stub into a computed criterion: the
decision log (4B), the kill switch and rollback record (4C), the review queue
(4D), per-agent boundaries (4E), and trusted evals (4F). The regenerated sample
scorecard is in `content/cycle-13/`; the decision is ADR 0016.
