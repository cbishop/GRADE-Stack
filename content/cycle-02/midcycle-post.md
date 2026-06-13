# Cycle 02 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

This cycle I'm turning the eval suite into a gate that **blocks** bad PRs, and I
hit a decision I didn't expect to be interesting: *what model should the gate run
against?*

The obvious answer is "the real one." But a gate has a different job than a
benchmark. A benchmark wants to be faithful. A gate wants to be **trustworthy** —
deterministic, fast, and impossible to route around. Those aren't the same thing,
and the real model fails two of the three:

- My production model (Claude on Bedrock) has **no seed** — runs vary slightly,
  so a gate built on it can flake and erode trust the first time it fails for no
  reason.
- It needs cloud credentials, which GitHub deliberately won't hand to a pull
  request from a fork — so the gate would silently do nothing for outside
  contributors.
- And there's a wrinkle specific to where I am: my naive agent currently scores
  **0/12** on Claude (the JSON-fencing bug from last cycle). You can't demonstrate
  "this PR made it worse" against a baseline that's already zero.

So for the gate itself I'm using a deterministic stand-in: a hermetic provider
with no network and no credentials that returns fixed output. The gate then
proves the **mechanism** — "a regression is caught and the build fails" —
reproducibly and for free. Real-model quality stays measured locally and shows up
in the cost numbers; a real-cloud gate job gets added once the fencing bug is
fixed next phase.

It felt like a cop-out for about an hour, until I wrote it down as a decision
record: a gate's value is that it's *boring and reliable*. The moment a gate is
flaky, people start ignoring it — and an ignored gate is worse than no gate,
because it looks like coverage.

The other half of the cycle is the metric I actually want on a slide:
**cost-per-success**. More on that when it ships. (Spoiler: cost-per-*call* is the
number that lies.)
