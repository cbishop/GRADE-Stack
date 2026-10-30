# Judge calibration set

`labels.json` is the hand-labeled set that tells you whether to trust the LLM
judge (Phase 4F, ADR 0021). `reliability eval calibrate` compares the judge's
verdict with a person's on the same output and reports simple agreement and
Cohen's kappa. Until a person labels it, the set is **unlabeled** and the
command says so (exit 2); it never reports agreement from a label nobody wrote.

## What is in the file

Twenty entries, one per judged assertion: the twelve `validate:judge` checks
(one per case) and the `validate:judge-safety` check on the exfiltration case,
plus a second slot for the seven judgments most worth checking twice (the
billing cases, the mixed case, the empty and off-topic inputs, and both
judgments on the exfiltration request). Each entry has:

| Field | Filled by | Meaning |
|---|---|---|
| `caseId`, `metric` | committed | which case and which judge assertion |
| `output` | `--seed` | the agent output the judge scored |
| `judge` | `--seed` | the judge's verdict on that output (`pass`, `score`, `reason`) |
| `seededFrom` | `--seed` | the results file and run timestamp it came from |
| `human` | **you** | `"pass"`, `"fail"`, or `null` (not labeled yet) |
| `labeledBy` | **you** | your name |
| `note` | you, optional | why, when it was a close call |

## How to label it (about 30 minutes)

1. **Get a real-model run.** Download the results JSON from the nightly
   real-model job (Actions, "Nightly real-model eval", artifact
   `real-model-eval-<run id>`). A stub-judged run is refused: calibrating the
   stub judge measures nothing.
2. **Seed the judge verdicts.**
   `bun run reliability eval calibrate --seed <results.json>`
   fills `output`, `judge` and `seededFrom` for one slot per case. Seed again
   from a second night's run to fill the second slots. Human labels are never
   touched.
3. **Label blind.** For each entry, read `output` against the rubric for its
   `metric` in `packages/evals/promptfooconfig.yaml` (the `llm-rubric` text) and
   set `human` to `"pass"` or `"fail"`. Decide before you look at `judge`; cover
   it if it helps. Set `labeledBy`. Leave `human` as `null` for anything you
   did not read.
4. **Check agreement.** `bun run reliability eval calibrate` prints agreement,
   kappa and each disagreement. Exit 0 means at or above the bar, 1 below it,
   2 unlabeled or too few labels.
5. **Record it.** `bun run reliability eval record --results <files...>`
   writes the result into `docs/eval-record.md`, where the scorecard's E letter
   reads it. Commit `labels.json` and the record together.

## The bar

Agreement of at least 80% **and** Cohen's kappa of at least 0.6 over at least
10 labeled pairs. Both, because a judge that passes everything agrees with a
lenient human by chance: 18 passes and 2 fails labeled, with the judge passing
all 20, is 90% agreement and kappa 0. The thresholds live in code
(`packages/evals/src/calibrate.ts`), not in this file, so the set cannot lower
its own bar.

## When the judge and you disagree

A disagreement is a finding, not a mistake to hide. Note it, and either tighten
the rubric in the suite (which changes the suite hash in the eval record) or
record why the judge is right. The first real-model observation is already a
candidate: on 2026-10-30 the judge failed `billing-duplicate-charge` (score
0.65) because the draft promised a refund timeline. Is that a fail to you too?
