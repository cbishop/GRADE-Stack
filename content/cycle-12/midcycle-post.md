# Cycle 12 — Mid-cycle "working on / what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**This cycle I did a post-mortem on my own build — and the most interesting bug
wasn't a crash. It was a metric that was telling executives the truth in a way
that was, functionally, a lie.**

The stack scores itself against the OWASP Top 10 for Agentic Applications. Two of
the ten threats are **Memory & Context Poisoning** and **Insecure Inter-Agent
Communication**. My reference agent is single-agent and stateless — it has no
long-term memory and no agent-to-agent channel. So it has no mechanism for either
threat. My scorecard dutifully marked them as **gaps** and the guardrail rating
came out **At risk**.

Technically accurate. Practically misleading. Picture the exec reading it: "two
gaps to close — fix them." But there's nothing to fix. You can't harden a memory
subsystem that doesn't exist. The "gap" isn't a deficiency in the code; it's a
*boundary* of the architecture. Reporting it as a gap manufactures a to-do item no
one can ever complete, and drags the whole report down with it.

Here's the part that stung: **I'd already solved this — twice — and never went
back.** My EU AI Act module (built two phases later) scores readiness only over
the obligations the stack can actually support, and lists the purely-legal ones
separately as "the deployer's, not the tool's." My NIST mapping literally says in
its own data file: *"a control the stack cannot provide is a responsibility
boundary, not a deficiency."* The OWASP module was the **first** governance piece I
built, and it was running the naïve v1 of an idea I'd clearly improved later. The
review caught a fossil.

The fix is an honesty mechanism, not a fudge:

- Each threat gets a `scored` flag. Out-of-scope threats are **reported** (you
  still see them, and *why* they're out of scope) but **excluded from the score's
  denominator** — they're boundaries, not gaps.
- "Out of scope" can't become a quiet escape hatch: the schema *requires* an
  out-of-scope item to state why the capability is architecturally absent, and CI
  prints the split so any reclassification shows up in review.
- A "no true gaps" floor: if every *applicable* threat has a mechanism and none is
  unaddressed, the rating is at least Adequate — because shallow coverage isn't a
  hole.

The honest part I want to be loud about: the fix **does not** turn everything
green by fiat. Six threats are still only *partially* covered, each with a named
residual gap a real deployment must close. Those stay visible and actionable.
What changed is that the two unfixable items stop masquerading as work.

Next post: the second bug — the one where my shippable binary couldn't actually
ship — and why "all tests pass" lied to me about it.
