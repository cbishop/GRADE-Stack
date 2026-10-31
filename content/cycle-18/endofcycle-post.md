# Cycle 18: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**An eval you have not run on the real model lately is a belief, not a measurement.**

My eval suite has passed 12 out of 12 every day for four months. It passed on a
stand-in model I wrote, one that gives the same answer every time. That proves
the plumbing works. It says nothing about the model a customer would actually
talk to.

This morning I ran two cases on the real model. One failed. The agent drafted a
reply to a customer who was charged twice, and it promised a refund timeline.
The agent cannot know that. My grader caught it and scored it 0.65. The
stand-in had passed that case every single time.

A bank's model-risk reviewer asks three questions about any eval. When did it
last run on the real model? Do you trust the grader? Does it still hold on
what you shipped? This is Phase 4F, the last of the six, and it answers each
one with a file.

What changed:

**1. The real model runs every night.** A scheduled job runs the full suite
against the production model, under a spending cap of 50 cents, and keeps the
results for 90 days. Pull requests are still checked against the stand-in,
because that check is free, fast and exact. The nightly run measures; it does
not block anyone.

**2. The grader gets graded.** My grader is another AI model reading the
agent's reply against a short rubric. I am labeling 20 of its verdicts by hand,
without looking at what it said. The tool reports how often we agree, and a
second number that discounts lucky agreement. A grader that passes everything
can agree with a lenient human 90% of the time and still be useless. Today the
set is unlabeled, and the tool says "unlabeled", not a number.

**3. Production answers get re-scored.** The gateway can keep a copy of what
the agent actually sent (off by default). One command runs those copies back
through the same checks and the same grader. Every failure names the request it
came from, so it leads straight to the log line and to the person who approved
it.

**4. One record says whether to trust the suite.** An eval record lists the
suite's fingerprint, the last real-model run, the grader's agreement with me,
and the last production re-score. Half of it is a form the owner fills in:
who owns it, how often it runs, how a production failure becomes a new test.

**5. The scorecard tells the truth about E.** The E letter, Evaluated, reads
that record. Today it says Critical: no full real-model run is on file yet, the
grader is unchecked, and nothing from production has been re-scored. That is
the honest grade. Once the first nightly results are recorded and I finish
labeling, it moves. Make the record a month old and E drops again.

Also fixed, from last cycle: the built tool can start its own tool server
again, and the local model now stops writing at its token limit (233 tokens
down to 16 when capped at 16).

What it does not do yet: compare the real model against a committed baseline.
That waits for two nightly runs that agree, so the baseline is a measurement
and not one lucky night.

That closes v3: trusted evaluation, full traceability, rollback, and a human
review queue, each one a mechanism with a record. The decision is ADR 0021; the
eval record is `docs/eval-record.md`.
