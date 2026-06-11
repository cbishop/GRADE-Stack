# Cycle 00 — Mid-cycle "what I'm setting up" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

Before writing a single line of agent logic, I spent cycle zero on the boring
stuff that decides whether a public project survives contact with reality.

What I set up — and why it matters more than the demo:

**One seam every model call flows through.** Bedrock and Ollama sit behind a
single provider interface. The naive agent uses it now; the eval judges, the
gateway, and the guardrails will use the *same* seam later. You can't bolt
governance onto an agent that calls five SDKs directly.

**Mechanisms, not reminders.** "Don't commit secrets" is not a sentence in a
README — it's a CI scan, a git pre-commit hook, and a tool-use guard. "Don't
publish internal strategy" is a hook that blocks the commit. If a rule matters,
it should be a failing check, not a hope.

**A unit of work that's honest.** One narrow task — triage a support email — that
the *entire* build is measured against. No moving goalposts.

**Legally forkable from day one.** Apache-2.0, with attribution that propagates.
A "public" repo with no license isn't actually open.

Unglamorous? Completely. But this is the difference between a repo people can
trust and a demo people clap for once.

Next cycle: making the naive agent *measurable*.
