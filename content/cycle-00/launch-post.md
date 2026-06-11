# Cycle 00 — Launch post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

I'm building the open reference stack for getting mid-market AI agents to
production — in public. Here's the repo, and here's why.

Most mid-market companies trying to ship an AI agent hit the same wall. The demo
works. Then someone asks: *Is it reliable? Can we see what it's doing? Who signs
off that it's safe?* — and there's no good answer, because the enterprise
playbook assumes an ML platform team they don't have.

So I'm building the right-sized version of that playbook, out in the open:

**GRADE-Stack** — a reference stack that takes a naive agent and makes it
**reliable, observable, and governed**, one increment at a time.

It starts deliberately unimpressive. Day one is a naive agent that triages a
support email — no evals, no tracing, no guardrails. That's the *"before"*. Every
cycle after this adds one layer and shows the measurable difference:

- make it **measurable** (an eval harness),
- make regressions **impossible to merge** (a CI gate + cost-per-success),
- make it **legible to a board** (an AI Reliability Scorecard),
- then a reference architecture, MCP integration, a guardrail gateway, and
  governance mappings (OWASP / NIST / EU AI Act).

It's Apache-2.0 and free to fork. I'll post the wins *and* the dead ends.

Repo: github.com/cbishop/GRADE-Stack

If you're trying to get an agent past the demo and into production without an ML
platform team, follow along — and tell me where your wall is.
