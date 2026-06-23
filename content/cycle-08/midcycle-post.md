# Cycle 08 — Mid-cycle "working on / what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**This cycle I'm mapping the reference stack against the OWASP Top 10 for Agentic
Applications — and the first surprise was the list itself.**

If you mapped your agent against OWASP's agentic threats even a year ago, you may
have used a `T1`–`T15` numbering. The published **2026** edition (out December 2025)
is a different beast: ten items, `ASI01:2026` through `ASI10:2026` — Agent Goal
Hijack, Tool Misuse, Identity & Privilege Abuse, Supply Chain Compromise,
Unexpected Code Execution, Memory & Context Poisoning, Insecure Inter-Agent
Communication, Cascading Failures, Human-Agent Trust Exploitation, Rogue Agents.

So step one wasn't mapping — it was *re-verifying the taxonomy at build time* and
citing the exact edition. Mapping against a stale identifier scheme would be wrong
on its face, and "we follow OWASP" means nothing if you can't say which OWASP.

The second surprise is more uncomfortable, and it's the honest part: **a single,
well-built reference agent does not "cover" all ten.** I can name a real, shipped
mechanism for most of them — the gateway blocks instruction-override server-side,
the agent holds zero provider credentials, tool selection is name-blind, the
validator is a schema-parse not prompted JSON, loops are bounded. But two threats
— memory/context poisoning and insecure inter-agent communication — describe
attack surfaces this architecture *doesn't even have* (it's single-agent and
stateless). The wrong move is to quietly call those "covered." The right move is to
flag them as **gaps** anyone adding long-term memory or a second agent must close.

What I'm building so this can't drift: one machine-readable mapping file (the source
of truth), a human-readable version, and a CI check that **fails the build** if any
of the ten threats is missing, claims coverage without naming a mechanism, or flags
a gap without saying what's left open. Per the rule this whole project runs on:
if "no silent omissions" is a must, it has to be a check, not a sentence.

Next post: what happens to the executive scorecard when this lands.
