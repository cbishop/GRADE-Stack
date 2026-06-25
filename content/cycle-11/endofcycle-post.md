# Cycle 11 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**The regulated / sovereign mid-market variant is shipped: the full GRADE-Stack
pipeline — agent, evals, scorecard — runs entirely on a local model with the
network severed. And "no cloud dependency" isn't a claim in the README; it's a
mechanism that fails loudly if you break it.**

One command proves it:

```
$ reliability sovereign verify --gateway

Guard (mechanism is live):
  ✓ a call to a cloud host is blocked at the egress guard
  ✓ the local model (ollama) is reachable over loopback
Pipeline (runs entirely on this machine):
  ✓ agent: ollama/gemma4:12b-mlx, 1 turn(s)
  ✓ evals: 11/12 passed (judge: ollama, stability 1.00)
  ✓ scorecard: overall at-risk
Gateway + credential isolation (air-gapped, Phase 2C):
  ✓ agent (no creds) reaches the model only via the local gateway; a direct call fails
✓ Sovereign variant verified: the full pipeline ran with no cloud dependency.
```

Three things I want to call out, because they're where the credibility lives:

**1. The proof fires a real shot.** The command doesn't check "is the guard
installed?" — it sends a request at a cloud host and confirms it's *blocked*.
Installed isn't enforcing. If the guard ever stopped working, this exits non-zero.

**2. The judge runs locally too.** Grading an agent usually means a second,
smarter model marking the first one's homework — and that model is usually in the
cloud. I made the judge portable back in Phase 1A specifically so the air gap
wouldn't break here. All grading runs on the local model.

**3. The honest cost answer: self-hosting usually doesn't save money.** Local
inference has no per-token bill — cost-per-success defaults to **\$0**, with an
optional amortized-hardware rate if you want a real figure. At an illustrative
\$1.20/MTok amortized, the reference agent costs ≈ **\$0.0017 per success**. That
*looks* cheaper than cloud list price — but it ignores that you now own the GPU,
the model upgrades, the capacity planning, and the on-call. Self-hosting only
pencils out above meaningful token volume, and the engineering effort is real.

So why ship it? Because for the buyers this is for, **cost-per-success is the wrong
question.** Theirs is: *can this run at all, with data that legally cannot leave
the boundary?* And the answer is now provably yes — same stack, same scorecard,
zero egress. The quality gap is honest too: the one eval miss is the smaller local
model over-promising in a draft reply — a quality gap, not a reliability-mechanism
gap. Schema validation, turn bounds, and guardrails all hold air-gapped.

That closes Phase 3 and the build: a reference stack a mid-market team can take to
production — measured, observable, governed — and, if they must, run entirely on
their own hardware. Repo's open; the sovereign runbook is in `docs/`.
