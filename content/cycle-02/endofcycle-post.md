# Cycle 02 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**Cost-per-success is the metric your board actually understands. Cost-per-call
is the one that lies.** This cycle I shipped both it and an eval gate that blocks
regressions automatically.

Cost-per-call is the number everyone quotes because it's easy: tokens × price.
The problem is it rewards exactly the wrong thing. An agent that's cheap per call
but fails half the time isn't cheap — you're paying for the failures *and* the
retries *and* the human who cleans up after it. The honest unit isn't "what did a
call cost," it's **"what did a correct outcome cost."**

So that's what the harness now reports, on every run:

```
cost-per-success: $0.00042  (1830 tokens/success)
```

Total dollars over the run, divided by the cases that actually passed. If nothing
passes, the answer is `n/a` — not zero — because cost-per-success is *undefined*
when there are no successes. Tokens are always counted; dollars follow each
provider's real pricing, and the local-model path is \$0 by default with an
optional "amortize my hardware" rate for when that conversation matters.

The second thing that shipped is the **gate**. Last cycle the eval suite was a
report you could read and ignore. Now a pull request that makes the agent worse
**fails CI automatically** — I prove it with a `--degraded` switch that
deliberately breaks the agent's output; the suite collapses, the gate goes red,
the build stops. It compares each run against a committed baseline within a
tolerance band, so ordinary nondeterminism never flakes it, and a real drop
always does.

Two design calls I wrote down as decision records rather than burying in code:

**The gate runs against a deterministic stand-in, not the live model.** A gate's
whole value is that it's boring and reliable; a flaky gate gets ignored, and an
ignored gate is worse than none. So CI proves the *mechanism* — regression caught,
build blocked — hermetically and for free. Real-model quality is measured locally
and lives in the cost numbers. A live-cloud gate job joins it next phase.

**A fork PR can't merge ungated.** GitHub won't give cloud credentials to outside
contributors' PRs, so the eval gate is a required check that a maintainer
explicitly enables per fork PR after review — coverage that doesn't quietly
evaporate for the exact contributions you most need to scrutinize.

There's also an enforced loop bound now (`--max-turns`) — a runaway agent can't
spin forever; it's structural, not a polite suggestion.

Gate, cost-per-success, and the two decision records are in the repo
(Apache-2.0): github.com/cbishop/GRADE-Stack

Next cycle: the flagship artifact — a one-page **AI Reliability Scorecard** a
board could read in three minutes, every rating traced back to this evidence.
