# ADR 0016: GRADE-letter dimension realignment

- **Status:** Accepted
- **Date:** 2026-10-28
- **Phase:** 4A (honesty edits and GRADE-letter scorecard realignment)

## Context

The README promises five pillars, one per letter: **G**overned, **R**eliable,
**A**gentic, **D**eployed, **E**valuated. The scorecard graded five different
things: Reliability, Cost discipline, Observability coverage, Guardrail coverage
and Governance readiness (v2, Phases 1C to 3C). The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`) found the mismatch, plus two
governance ratings ("supported" for human oversight and for logging) with no
mechanism behind them.

The scorecard is the readout a buyer's reviewer reads first. If its headings do
not match the letters the product is named for, and if a letter can look graded
when nothing measures it, the scorecard overclaims in the same way the two
governance ratings did. v3 also needs a slot for every criterion its later
sub-phases (4B to 4F) will compute, so the scorecard can serve as the living map
of v3 progress.

## Decision

**1. The five dimensions are the five GRADE letters, in order.** Dimension ids
are `governed`, `reliable`, `agentic`, `deployed`, `evaluated`. Each renders with
its letter and full name ("G · Governed"). The v2 dimensions become criteria
under the letters:

| Letter | Computed today | Not yet assessed (fills in) |
|---|---|---|
| **G · Governed** | Governance readiness (EU AI Act deployer module) | Human oversight record (4D); Boundary register (4E) |
| **R · Reliable** | Reliability (pass rate, stability floor); Cost discipline (cost-per-success, waste) | none |
| **A · Agentic** | Guardrail coverage (OWASP applicable threats, no-true-gaps floor) | Declared vs observed autonomy and tool scope (4E) |
| **D · Deployed** | Observability coverage (connected trace, three phases) | Attributable and reconstructable (4B); Rollback verified (4C) |
| **E · Evaluated** | Suite breadth (from the results file) | Last real-model run freshness, Judge calibration, Post-deployment re-score (4F) |

**2. Cost discipline lives under R.** The confidence router (ADR 0015) and the
eval gate's cost cap are reliability-per-dollar controls: they trade spend
against dependable outcomes. Cost is also the one thing the four assurance
pillars do not grade, so it needs a home that keeps it visible. It stays a
separately graded criterion, with its own bands, under R.

**3. Every criterion is in exactly one of two states.** A closed TypeScript
union (`Criterion = ComputedCriterion | StubbedCriterion`, `packages/scorecard/src/types.ts`):

- **computed:** a rating from evidence, the evidence lines, and a citation with
  three parts: the source record (file and fields), the threshold applied, and
  what would change the grade.
- **stubbed:** `not-assessed`, the v3 sub-phase that fills it in (`fillsIn`, one
  of 4B, 4C, 4D, 4E, 4F), and the record it will be computed from.

There is no third state. The scorecard test asserts it over every criterion, and
the built-binary smoke test asserts the rendered page shows the five letters and
a "fills in Phase 4X" line for each of 4B to 4F. This is the 4A row of the
enforcement register: the scorecard cannot claim a letter it has no evidence for.

**4. A letter's grade is its weakest computed criterion.** Stubs are listed under
the letter but never raise or lower its grade. A letter with no computed
criterion would be `not-assessed` (none is today). The overall verdict is the
weakest letter (worst wins, unchanged from v2), and its headline names the
letter that set it and the number of criteria not yet assessed.

**5. Suite breadth (E) is three checks on the results file:** at least 10 cases;
a refusal or out-of-distribution case (matched by case id or description); and an
LLM-judge metric in some case's checks. The share of checks met is banded with
the unchanged `standardBand` helper, so all three is Strong, two is At risk, and
one or none is Critical. Band thresholds for every v2 criterion are unchanged.

**6. The evidence inputs are now required.** `buildScorecard` takes trace
coverage, the OWASP coverage and the EU AI Act readiness as required options.
v2 let them be omitted and stubbed the dimension with a v2 phase name (2D, 3A,
3C); those phases have shipped, and an omitted input would be a third state.

## Rationale

- **The letters are the product.** A reader who sees G, R, A, D, E on the README
  and five unrelated headings on the scorecard has to translate; the scorecard
  should do that once, in code.
- **Weakest-computed is the honest rollup.** An average would let a strong
  criterion hide a weak one, and counting stubs as anything (zero or neutral)
  would either punish the stack for unbuilt slots or let them pass silently.
  Worst-wins is the rule the overall verdict already used.
- **Citations make each grade checkable.** A reviewer can open the cited file,
  apply the stated threshold, and reproduce the grade.

## Consequences

- **The sample scorecard got worse, honestly.** With the two EU AI Act overclaims
  corrected to `partial`, governance readiness falls from 0.75 (3 supported, 3
  partial) to 0.58 (1 supported, 5 partial), G drops from Adequate to At risk,
  and the overall verdict moves from Adequate (weakest: Reliability) to At risk
  (weakest: G · Governed). NIST MEASURE 3 and MANAGE 4 also moved to `partial`
  (the NIST mapping is not scored, so no grade changes).
- **A letter can read Strong while most of its criteria are stubs** (D and E
  today). The page shows the stubs next to the grade, and the overall headline
  counts them; the grade itself reflects only what is measured.
- **Governance readiness is computed from the EU AI Act module only**, as in v2.
  The NIST mapping is checked by CI but carries no weights; scoring it would be a
  new rule, not a regroup, and is left out of 4A.
- **Suite breadth does not move in degraded mode.** It grades the suite's shape,
  not the run. Degraded mode still drops R to Critical and the overall verdict
  with it. 4F's criteria (freshness, calibration) are where E becomes sensitive
  to a bad run.
- Each later sub-phase replaces one stub with a computed criterion and a
  citation; the test that forbids a third state keeps that transition honest.
