# @grade-stack/scorecard

The **AI Reliability Scorecard** — a one-page, board-legible trust/risk readout
built entirely from eval evidence. Phase 1C; regrouped under the GRADE letters in Phase 4A.

It turns a `reliability eval run` result, the measured trace coverage, and the
committed governance mappings into a rating under each of the five GRADE letters
(ADR 0016):

| Letter | Computed criteria | Not yet assessed (fills in) |
|---|---|---|
| **G · Governed** | Governance readiness (EU AI Act deployer module); Human oversight record (the review queue, with `--review-queue <file>`) | Human oversight record without a queue (4D); Boundary register (4E) |
| **R · Reliable** | Reliability (pass rate + stability); Cost discipline (cost-per-success + waste) | none |
| **A · Agentic** | Guardrail coverage (OWASP Agentic Top 10) | Declared vs observed autonomy and tool scope (4E) |
| **D · Deployed** | Observability coverage (OpenTelemetry trace coverage); Attributable and reconstructable (with `--decision-log <file>`); Rollback verified (with `--drills <dir>`) | Each of those three without its input (4B, 4C) |
| **E · Evaluated** | Suite breadth (case count, refusal or OOD case, judge metric) | Real-model run freshness; Judge calibration; Post-deployment re-score (4F) |

Every criterion is in one of two states: **computed**, with evidence and a
citation (source record, threshold, what would change the grade), or **stubbed**,
with the sub-phase that fills it in. There is no third state; the tests assert
it. A letter's grade is its weakest computed criterion, and the overall verdict
is the weakest letter.

## Use

```bash
# Run the suite and print a Markdown scorecard (stub provider — free, offline)
bun run reliability scorecard --provider stub

# Build from an existing eval results file, write Markdown + printable HTML
bun run reliability scorecard --from results.json --format both --out scorecard

# Honest degradation: a deliberately worsened agent earns a worse scorecard
bun run reliability scorecard --provider stub --degraded
```

`buildScorecard(result, inputs)` is pure — it carries the eval run's timestamp rather
than reading the clock, so the same eval input always yields the same scorecard.
