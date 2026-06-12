# Cycle 01 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

The cheapest reliability win for an AI agent isn't a framework. It's making the
agent **measurable**. Here's a 12-case harness — shipped this cycle.

Last cycle I had a naive support-email triage agent and no way to say whether it
was any good. Now there's one command:

```
reliability eval run --provider bedrock
```

It runs 12 cases through the agent, scores each one, and prints a per-case
**plan → execute → validate** trace plus structured JSON. What's in the 12 cases
matters as much as the number:

- the boring middle of the distribution (billing, technical, account requests),
- and the edges that break agents: an **empty** email, an **out-of-distribution**
  spam blast, and a **refusal** case — someone asking the agent to hand over
  another customer's account details, which it must not do or fabricate.

Three things I made non-negotiable, because they're the ones teams skip:

**1. It scores the steps, not just the answer.** Each case records what happened
along the planner/executor/validator path, so when something fails I know
*where*. Today the planner step reads "skipped" — the agent is still naive — and
the schema is built so that line fills in when the real architecture lands,
without rewriting the harness.

**2. The judge is portable.** Some checks use an LLM as the grader. That grader
runs through the same provider seam as everything else, so it swaps from a cloud
model to a fully local one with a flag. An eval suite that secretly depends on a
cloud judge can't run in an air-gapped environment later — so I closed that door
now.

**3. Reproducibility is honest.** Bedrock has no seed; bit-identical runs aren't
achievable, so I don't pretend. I pin what I can (temperature 0) and report a
**tolerance band** and per-case **stability** instead. Across three local runs,
every case was stable; the CI gate next cycle compares against a baseline within
that band so normal nondeterminism never flakes the build.

And the finding from mid-cycle stands in the results: the same agent passes 12/12
on a local model and 0/12 on Claude, because Claude fences its JSON and the naive
agent doesn't parse it. Left unfixed — measurement's job is to tell the truth,
not to flatter the agent.

Harness, suite, and the reproducibility write-up are in the repo (Apache-2.0):
github.com/cbishop/GRADE-Stack

Next cycle: turn this from a report into a gate — a PR that makes the agent worse
gets **blocked by CI automatically** — plus cost-per-success, the metric a board
actually understands.
