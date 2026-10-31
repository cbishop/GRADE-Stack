# ADR 0021: Nightly real-model job, judge calibration, and trace re-scoring

- **Status:** Accepted
- **Date:** 2026-10-30
- **Phase:** 4F (Evaluated: real-model runs, judge calibration, and post-deployment re-scoring)

## Context

The eval suite was trusted on faith. The CI gate ran only against the
deterministic stub (ADR 0003), so it proved the harness, not the model; the
real-Bedrock job promised in Phase 1B never existed. The LLM judge had never
been compared with a human, so its pass verdicts were unverified. Nothing
re-scored what the agent actually returned in production. The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`, row 1) lists all three, and
the scorecard's E letter stubbed them as 4F's. The first manual real-model run
(2026-10-30, two cases on Bedrock Haiku 4.5) made the point: a case the stub
always passed, `billing-duplicate-charge`, failed the judge at 0.65 because
the draft promised a refund timeline.

## Decision

**1. A nightly real-model job that measures, not gates.**
`.github/workflows/nightly-real-model.yml` runs the full suite on Bedrock at
07:17 UTC and on `workflow_dispatch`, on `main` only, with the AWS credentials
as repository secrets. It uploads the results JSON and an eval record built
from it as an artifact (90 days). `eval run --max-cost` now exits 2 when the
run overspends the cap (0.50 USD, the gate's existing cap), and the job fails
on that or on a missing results file; failing cases exit 1 and are recorded,
not fatal, because there is no Bedrock baseline yet to regress against. PR
gating stays on the stub; ADR 0003 stands. A reviewed `baseline.bedrock.json`
is committed only after two consecutive nightly runs agree within the
tolerance band.

**2. Judge calibration against a fixed threshold.** `eval calibrate` reads
`packages/evals/calibration/labels.json` (Zod schema), one entry per judged
assertion: case, metric, the output the judge scored, the judge's verdict and
the human label. It reports simple agreement and Cohen's kappa. The bar is
agreement at least 80% **and** kappa at least 0.6 over at least 10 labeled
pairs. Kappa is required because simple agreement flatters a judge that
passes everything: 18 human passes, 2 human fails and a judge that passes all
20 is 90% agreement and kappa 0. The thresholds are constants in
`packages/evals/src/calibrate.ts`, not fields in the labels file, and the
scorecard re-judges the numbers rather than trusting a record's stated
status, so neither the labels file nor a hand-edited record can lower the bar.
An unlabeled set reports `unlabeled` (exit 2); below the bar exits 1.
`--seed <results>` fills judge verdicts from a real-model run, one slot per
case and metric per run, never touching human labels, and refuses a
stub-judged run. `eval label` is the labeling path: it walks each seeded,
unlabeled entry with the case input, the rubric and the agent output, asks
pass or fail before revealing the judge's verdict (blind), and saves after
every answer. The committed set holds twenty entries and is unlabeled
until Clarke labels it.

**3. Trace re-scoring through the suite's own assertions.** `eval run
--from-traces <dir>` reads the 4B capture directory through the capture
schema (a malformed capture fails loudly), keeps captured triage answers, and
skips blocked requests and non-triage calls (MCP tool selection) with a
reason. Each answer becomes a promptfoo test replayed by the bridge's new
`replay` mode, so the suite's `defaultTest` assertions and the LLM judge grade
exactly what production returned, with no agent call. Per-case expected
labels do not apply to production traffic. The result is stamped `source:
"traces"`, and every case carries `requestId` and `callerId`, which join it to
the decision log, the trace and any review item. Degraded mode applies to
replayed outputs, so `RELIABILITY_DEGRADED=1` makes a re-score fail.

**4. The eval record.** `eval record` writes `docs/eval-record.md`: a
deployer template (owner, cadence, labeler, re-score sample, incident-to-case
workflow, residuals, dated observations) and a computed block between HTML
comment markers holding sentences plus a JSON record (Zod schema): suite
definition SHA-256, committed baselines, the newest non-stub suite run, the
calibration report, and the newest re-score. Regenerating replaces only the
computed block. A record with no block, or a malformed one, fails loudly.

**5. Scorecard E is computed from the record.** `scorecard --eval-record`:
*real-model freshness* (Strong within 30 days on the full suite, Adequate for
a partial run, At risk to 90 days, else or none Critical); *judge
calibration* (Strong at the bar, Critical below, At risk unlabeled or too
few); *post-deployment re-score* (the worse of age, same bands, and the
re-scored pass rate on the reliability bands; none Critical). With suite
breadth (4A), E has no stubs left when the record is given.

**6. Carried-over fixes.** The reference agent spawns the stdio MCP server by
re-running its own entry with `mcp serve` (the CLI from source or `dist/`, or
the eval bridge), replacing `SERVER_BIN`, which pointed at a missing
`dist/bin.ts`. Ollama receives `maxTokens` as `num_predict`. The evals package
resolves its directory from the working directory when bundled. The local
`Stop` hook runs the stub gate and blocks on a regression.

## Consequences

- The scorecard now says plainly that the suite has not been measured on a
  real model in its window, until the first nightly artifact is recorded.
- Calibration costs Clarke about 30 minutes per labeling round and has to be
  repeated after a rubric or judge-model change; the suite hash in the record
  shows when that happened.
- The nightly job spends real money (about 0.03 USD per full run at
  today's prices), bounded by the cap and a 30-minute timeout.
- Re-scoring needs content capture on, which is opt-in (ADR 0017): a deployer
  who never captures cannot reach Strong on post-deployment.
- The record is regenerated by hand from downloaded artifacts; automating the
  commit is deferred until the baseline exists.
