# Cycle 03 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

This cycle I'm building the flagship artifact of the whole project: a one-page
**AI Reliability Scorecard** a board could read in three minutes. And the part
that surprised me wasn't the rendering — it was deciding *what I'm allowed to put
on it.*

The tempting move with an executive readout is to fill the page. Five dimensions,
five green checkmarks, looks complete, ship it. But three of my five dimensions —
observability, guardrail coverage, governance readiness — don't have any evidence
behind them yet. They get built in later phases. So what rating do they get today?

The honest answer is **none**. Not a guess, not a placeholder "good," not a zero
that reads as failing. The scorecard literally says *"not yet assessed — computed
in Phase 2D"* and moves on. An executive artifact that invents scores to look
finished is worse than one that's honest about its own coverage, because the
whole point of the thing is that someone trusts it.

That forced a rule into the code, not just the doc: **every rating must trace to
eval evidence, or it isn't a rating.** The two dimensions I *can* assess today —
Reliability and Cost discipline — pull their numbers straight from last cycle's
eval results. Reliability is the pass rate, knocked down a band if the runs are
flaky (a pass you can't reproduce isn't a pass). Cost discipline is the share of
spend that bought *no successful outcome* — computed from real per-case token
usage, so it's a genuinely different axis than reliability, not the same number
wearing a hat.

The other surprise: the scorecard generator is **pure**. It carries the eval
run's timestamp instead of reading the clock, so the same eval input always
produces the same scorecard — which means I can commit a sample one and test it.
An executive document you can regression-test is a strange and good feeling.

Next: wire it to the CLI, render a printable HTML version, and prove it degrades
honestly — point it at a deliberately-broken agent and watch every green light
turn red.
