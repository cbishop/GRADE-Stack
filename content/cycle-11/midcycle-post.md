# Cycle 11 — Mid-cycle "working on / what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**This cycle is the sovereign / on-prem variant — running the whole stack on a
local model with nothing leaving the machine. The surprise: I'd already built 90%
of it without realizing, and the hardest part was proving the air gap honestly.**

Some mid-market buyers can't send a prompt to a cloud model at all — regulated,
public-sector, data-sovereignty-bound. The usual answer is "we have an on-prem
version" followed by a fork that rots. I wanted the *same* stack, swap one flag,
runs entirely on Ollama: agent, evals, **and** the LLM-as-judge grading.

What surprised me is how much of this was decided phases ago, on purpose:

- One provider abstraction (Phase 0) → swap Bedrock for a local model with a flag.
- A **portable judge** (Phase 1A) → no eval metric secretly phones a cloud model
  to grade. If I'd let one cloud-only judge creep in back then, the air gap would
  be broken now and I'd be rewriting the harness.
- The gateway (2C) and tracing (2D) were both built **off by default** → there's no
  cloud dependency to disable.

The hard part is the part I'm most opinionated about: **how do you *prove* "no
cloud dependency"?** The lazy version is a README line and a screenshot. That
binds nobody — the first dependency that quietly reaches out makes it a lie.

So I'm building it as a **mechanism**: an egress guard that wraps `fetch` and
throws on any call to a non-loopback host. Localhost works (that's where Ollama
and the gateway live); anything aimed at the cloud fails *loudly*. And the proof
command doesn't just check the guard is installed — it fires a call at a cloud
canary and confirms it's actually blocked. "Installed" isn't "enforcing."

The honest seam I had to think hardest about: the guard catches `fetch`, but the
AWS SDK uses a different transport. Rather than patch Node's HTTP layer, I leaned
on Phase 2C — a direct cloud call has no credentials to authenticate with, so it
fails anyway. Two mechanisms composing beats one leaky catch-all.

Next post: the numbers — does self-hosting actually save money? (Honest answer:
usually not, and that's not the point.)
