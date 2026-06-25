# Cycle 12 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**Post-mortem shipped. Three findings, three fixes, all enforced by mechanisms —
and the headline number on the scorecard moved from "At risk" to "Adequate" by
becoming *more* honest, not less.**

What the review found and what I did about it:

**1. The scorecard was penalizing the architecture for things it deliberately
isn't.** Two OWASP agentic threats (memory poisoning, inter-agent comms) target
capabilities a single-agent, stateless stack doesn't have. They were scored as
gaps and dragged the rating to At risk. Now they're marked out of architectural
scope: reported with a stated reason, excluded from the score, and — guarded by
the schema — unable to become a silent escape hatch. A "no true gaps" floor keeps
the rating honest in the other direction: every applicable threat has a named
mechanism, none is unaddressed, so the dimension reads Adequate. The six *partial*
coverages stay visible as the real, closeable work.

**2. The only shippable artifact was broken — and "all tests pass" hid it.** The
built binary (`bun run build`) read its governance data from a path that was
correct from source but overshot the repo root once bundled — so `reliability
scorecard` crashed with `ENOENT` from `dist/`, while 164 green tests sailed past,
because every test ran from source. The lesson is old and keeps being true: *if
nothing tests the artifact you ship, you don't know it works.* Fix: the governance
data is now compiled into the binary, and a new smoke test builds the CLI and runs
it against the artifact. The bug class is now caught on every `bun test`.

**3. The same idea, implemented three different ways, had quietly drifted.** My
three governance modules each handle "this isn't the stack's to own" differently;
the oldest (NIST) even validated its data by hand while the others used a real
schema. I unified them: one validation model, one shared check runner the three
governance checks delegate to, a proper schema for NIST. ~250 fewer lines, and the
next governance module is a spec instead of a copy.

A meta-point I keep relearning: **a metric that's technically true but practically
misleading is worse than no metric** — it sends people to fix things that can't be
fixed and erodes trust in the number. Honest scoring means separating "we haven't
done this" from "this isn't ours to do," and saying which is which, out loud, in
the artifact.

Everything is enforced the same way the rest of this stack is — a failing check,
not a sentence in a doc. The full review is in `docs/post-mortem.md`; the decisions
are ADRs 0013 and 0014; the regenerated sample scorecard is in `content/cycle-12/`.
