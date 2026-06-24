# Cycle 08 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**I mapped the reference stack against the OWASP Agentic Top 10, wired it into the
executive scorecard — and the overall rating dropped from 🟢 Strong to 🟠 At risk.
That drop is the feature.**

For three cycles the scorecard read Strong: the agent is reliable, cost-disciplined,
and fully traceable. All true. But "Guardrail coverage" was an honest stub — *not
yet assessed*. This cycle it stopped being a stub. Here's the line it now produces,
computed straight from the OWASP mapping:

```
Guardrail coverage — 🟠 At risk
- Mapped against the OWASP Top 10 for Agentic Applications (2026, published 2025-12-09).
- 2 of 10 threats fully covered, 6 partial, 2 flagged as gaps (weighted coverage 50%).
- Explicit gaps to close before a fuller deployment: ASI06 (Memory & Context
  Poisoning), ASI07 (Insecure Inter-Agent Communication).
```

And because the scorecard rolls up to its **weakest** dimension, the whole card
moved to At risk. A worse-looking scorecard that's more honest beats a green one
that's hiding an unmeasured dimension. The point of the readout was never to look
good — it's to point a team at the actual work.

Three things made this credible rather than theatre:

1. **The taxonomy is cited, exactly.** OWASP's agentic list moved to the
   `ASI01:2026`–`ASI10:2026` scheme; I re-verified it at build time and recorded the
   edition and date in the mapping. "We follow OWASP" is meaningless without the
   version.

2. **Every rating traces to a named mechanism — or an admitted gap.** Covered items
   point at real code: the gateway's server-side injection denial, structural
   credential isolation (the agent has no keys), name-blind tool selection, the Zod
   schema-parse validator, the enforced turn bound. The two gaps are flagged, not
   buried — they're attack surfaces a single-agent, stateless stack doesn't have,
   and any memory-equipped or multi-agent deployment must close them.

3. **"No silent omissions" is a CI check, not a promise.** The build fails if any
   of the ten threats is missing, claims coverage without a mechanism, or flags a
   gap without saying what's left open. The mapping can't quietly rot.

If you run agents in production: pull the OWASP 2026 list, and for each item write
down the *named mechanism* that addresses it — or admit the gap. Most "we're
secure" decks can't survive that exercise. Mine produced an At-risk scorecard, and
I'd rather hand a board that than a green box I can't defend.

Sample scorecard (with the new Guardrail line) and the full mapping are in the repo.
