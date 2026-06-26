# GRADE-Stack — Post-Mortem Code Review

_Reviewed at commit `5bf8651` (Phase 3D complete). Scope: the whole repo, with a
deep focus on the OWASP guardrail scoring. 164 tests pass; `typecheck`, `check`,
and `test` are green. This review is deliberately tough — the architecture is
good, so the bar is "what would embarrass us in front of a paying CISO," not
"does it compile."_

> **Resolution (2026-06-25, branch `post-mortem-remediation`).** All findings in
> the prioritized action list (§7) are fixed. OWASP scoring now uses a `scored`
> applicability axis + a "no true gaps" floor ([ADR 0013](decisions/0013-owasp-guardrail-scoring-v2-applicability-and-no-true-gaps-floor.md));
> governance data is bundled into the CLI and covered by a built-binary smoke
> test, NIST has a real schema, and the three governance checks share one runner
> ([ADR 0014](decisions/0014-bundled-governance-data-and-unified-mapping-validation.md)).
> Guardrail coverage and the overall verdict are now **Adequate** — honestly,
> because every applicable threat has a named mechanism and none is unaddressed.
> Local gate green: typecheck, Biome + 4 governance checks, 174 tests, build. See
> `docs/PLAN-Grade-Stack-v2.md` → "Post-mortem remediation" and `content/cycle-12/`.

---

## 1. Verdict up front

This is a well-built reference stack. The discipline is real: pure scoring
functions with no I/O, Zod-validated governance data, "no silent omissions"
enforced in CI rather than asked for in a doc, SPDX headers, per-module `@module`
docs, honest `not-assessed` stubs instead of fake scores. That foundation is
better than most production codebases.

But there are three things worth fixing, in priority order:

1. **The OWASP scoring is dishonest in the way that matters to an executive** —
   it scores two structurally-impossible threats as "gaps," which is the issue
   you raised. Worse: the project *already solved this problem two phases later*
   in the EU AI Act module and never backported the fix. (§2)
2. **A confirmed shipping bug:** the built binary (`bun run build` → `dist/`)
   cannot generate a scorecard at all — it looks for the governance JSON two
   directory levels above the repo root and crashes. (§3)
3. **Real, mechanical duplication** across the three governance modules, their
   three CI check scripts, and the per-dimension headline/band boilerplate. None
   of it is "too clever" — it's the opposite, copy-paste that has now diverged in
   correctness. (§4)

Everything else is minor. Details below.

---

## 2. The OWASP scoring problem (your main concern)

### 2.1 What it does today

The guardrail dimension reads `governance/owasp/owasp-agentic-top10-2026.json`,
classifies each of the 10 threats `covered | partial | gap` (weights
`1.0 / 0.5 / 0.0`), and divides the weighted sum by a **fixed denominator of 10**
(`packages/scorecard/src/owasp.ts:124-148`). The band thresholds are
`≥0.9 strong, ≥0.7 adequate, ≥0.5 at-risk, else critical`
(`packages/scorecard/src/scorecard.ts:261-266`).

Two of the ten threats describe capabilities this architecture **does not and
will not have**:

- **ASI06 Memory & Context Poisoning** — the agent is stateless per run; there is
  no memory subsystem to poison.
- **ASI07 Insecure Inter-Agent Communication** — the stack is single-agent; there
  is no agent-to-agent channel to secure.

Both are classified `status: "gap"` (weight 0), kept in the denominator, and
rendered as _"Explicit gaps to close before a fuller deployment: ASI06:2026,
ASI07:2026."_ (`content/cycle-10/sample-scorecard.md:50`).

This is exactly the failure you described. An executive reads "At risk" plus a
list of "gaps to close," says "close them," and the honest answer is **"we
can't — there is no code to harden, because the capability doesn't exist."** The
scorecard is presenting an architectural *boundary* as a *deficiency*. That is
the one thing this whole project claims not to do: it asserts a problem it can't
back with actionable evidence.

The arithmetic also makes it self-fulfilling. With 2 covered + 6 partial + 2
forced-gap over 10: `(2·1 + 6·0.5 + 0)/10 = 0.50` → "at-risk". And because the
overall verdict is **worst-band-wins** (`scorecard.ts:384-406`), that one
dimension drags the entire scorecard's headline to "at-risk" regardless of how
strong reliability, cost, observability, and governance are. The two unfixable
items are capping the whole report.

### 2.2 The damning part: you already fixed this, twice, and didn't backport it

OWASP was Phase 3A — the *first* governance module. The two that followed both
handle "the stack structurally cannot provide this" **better**, and neither fix
was carried back:

- **NIST (Phase 3B)** states the principle outright in its own data file
  (`governance/nist/nist-ai-rmf-1.0-mapping.json`, `sharedResponsibility`):
  > "`deployer-owned` … marks a genuinely organizational control the stack cannot
  > provide — it is a responsibility boundary, **NOT a deficiency in the stack**."

  That sentence is the exact rebuttal to how OWASP scores ASI06/ASI07. NIST
  sidesteps the math problem by not feeding a numeric score at all.

- **EU AI Act (Phase 3C)** implements the mechanism cleanly
  (`packages/scorecard/src/eu-ai-act.ts:122-148`): every obligation carries a
  `scored: boolean`, and the readiness score divides by **`scoredCount` (only the
  stack-supportable obligations)**, not the total. `deployer-owned` duties that
  aren't the stack's to satisfy are listed for transparency but **excluded from
  the denominator** so they can't drag the rating down.

So the project's own most-recent design already says: *things outside the stack's
scope are reported, not penalized.* OWASP is running the abandoned v1 of an idea
the team demonstrably improved twice. This is the cleanest "first implementation
left behind" finding in the codebase, and your instinct caught it.

### 2.3 Recommended fix

**Backport the EU AI Act `scored`/denominator model to OWASP, and adopt NIST's
"responsibility boundary, not a deficiency" framing in the prose.** Concretely:

**(a) Add an applicability axis to the data.** In
`owasp-agentic-top10-2026.json`, give each item:

```jsonc
"applicability": "applicable" | "out-of-scope",
"applicabilityReason": "..."   // required when out-of-scope
```

Mark ASI06 and ASI07 `"out-of-scope"` with the reason already written in their
current `residualGap` text (stateless / single-agent). Keep their partial
mitigations as informational notes.

**(b) Score over applicable items only** (`owasp.ts`, `computeGuardrailCoverage`):
divide the weighted sum by the count of *applicable* items, mirroring
`scoredCount` in `eu-ai-act.ts:143`. Add `applicable: number`,
`outOfScopeIds: string[]`, and `outOfScopeReasons` to `GuardrailCoverage` exactly
as EU AI Act exposes `deployerOwnedIds`.

**(c) Enforce it as a mechanism, not prose** — this is a house rule
(`CLAUDE.md`: "mechanisms, not prose"). In the Zod schema (`owasp.ts:41-59`),
`.refine` that an `out-of-scope` item must carry a non-empty
`applicabilityReason`. This prevents "mark the inconvenient gaps as out-of-scope"
from becoming a loophole: an item can only leave the denominator if it states,
on the record, *why the capability is architecturally absent*. Update
`scripts/check-owasp-coverage.ts` to print the applicable/out-of-scope split so
CI surfaces any change.

**(d) Render it honestly** (`guardrailsDimension`, `scorecard.ts:275-309`).
Replace the "gaps to close" line for these items with a distinct, non-actionable
line. Target output:

> ### Guardrail coverage — 🟡 Adequate
> - Mapped against the OWASP Top 10 for Agentic Applications (2026).
> - **8 of 10 threats apply to this architecture; all 8 have a named, shipped
>   mechanism** (2 fully addressed, 6 partial with each residual gap stated).
>   **Zero applicable threats are unaddressed.**
> - 2 threats are **out of scope, not deficiencies**: ASI06 (Memory & Context
>   Poisoning) and ASI07 (Inter-Agent Communication) target capabilities this
>   single-agent, stateless stack does not include. They become relevant only if
>   you add persistent memory/RAG or a multi-agent topology — at which point this
>   stack provides no mechanism and you must add one.

That tells the executive precisely what is and isn't actionable: the 6 partials
are real, closeable work ("fix it" is a legitimate instruction); the 2 out-of-
scope items are forward-looking conditions on a different architecture, not a to-
do list.

### 2.4 Be honest about what this does *not* do

Excluding ASI06/ASI07 raises the score from `0.50` to `5.0/8 = 0.625` — which is
**still in the "at-risk" band** under the current `≥0.7` adequate threshold. So
the applicability fix alone does not turn the light green, and you should not
pretend it does. There are two defensible, separable decisions here — keep them
separate so the second can't be used to launder real weakness:

1. **Applicability (do this — it's correctness).** Stop presenting impossible
   threats as gaps. Non-negotiable; it's the dishonesty you flagged.

2. **Band semantics (optional, argue it on its merits).** Ask whether a stack
   where *every applicable threat has a named, shipped mechanism and zero are
   unaddressed* should really read "at-risk." A 0.625 here is "everything is at
   least partially covered," not "half of it is missing." Two honest options:

   - **A "no true gaps" floor:** if no applicable item is an unaddressed gap, the
     rating cannot be worse than Adequate. Defensible, and hard to abuse because
     it keys off *zero gaps*, not the average.
   - **Two-axis reporting** instead of one collapsed number — _breadth_ (% of
     applicable threats with any mechanism: 8/8 = 100%) and _depth_ (2 full + 6
     partial). The single weighted score hides that there are no holes, only
     shallow spots. This is more informative for a CISO than any band.

   My recommendation: ship (1) now; adopt the **"no true gaps" floor** in (2). It
   moves this card to Adequate *for a principled reason* (nothing is unaddressed),
   not by deleting inconvenient rows.

---

## 3. Confirmed bug: the built binary can't produce a scorecard

`bun run build` is a documented, first-class script (`package.json`) that bundles
the CLI to `dist/index.js`. The governance mappings are loaded by a path authored
relative to the *source* location (`packages/cli/src/`, three levels below the
repo root):

```ts
// packages/cli/src/index.ts:60
const OWASP_MAPPING_URL = new URL("../../../governance/owasp/...json", import.meta.url);
```

In the bundle, `import.meta.url` is `…/grade-stack/dist/index.js` (one level below
the root), so `../../../governance` overshoots the repo root by two levels.
Verified by running the built artifact:

```
$ bun dist/index.js scorecard …
ENOENT: no such file or directory, open
  '/Volumes/Userdata/Users/clarke/dev/governance/owasp/owasp-agentic-top10-2026.json'
```

(Note the path landed in `…/dev/`, two dirs above `…/dev/+2026/grade-stack`.)

It passes every test and the dev workflow because `bun run scorecard` runs from
source (`bun packages/cli/src/index.ts`), where the relative path is correct.
**Nothing exercises the built binary**, so the only shippable artifact is broken
and CI is blind to it.

**Fix options:** (a) embed the governance JSON via `import … with { type: "json" }`
so it's bundled, not read from disk — cleanest, and makes the data travel with the
binary; (b) resolve the path from a stable anchor (e.g. walk up to the nearest
`package.json`/repo marker) rather than counting `../`; or (c) at minimum, add a
smoke test that runs `dist/index.js scorecard --from <fixture>` so the build
artifact is actually tested. Do (a) **and** (c).

---

## 4. Complexity & duplication — what's worth cleaning up

Nothing here is over-engineered or too clever; the problem is the opposite —
repetition that has been copy-pasted and is now drifting.

### 4.1 Three divergent implementations of one concept (the root cause of §2)

"The stack structurally cannot provide X" is modeled three different ways:

| Module | Phase | Mechanism | Effect on score |
|---|---|---|---|
| OWASP | 3A | `status: "gap"` | counted, weight 0 → **drags score down** |
| NIST | 3B | `status: "deployer-owned"` | not scored at all (no dimension) |
| EU AI Act | 3C | `scored: false` + `deployer-owned` | **excluded from denominator** |

Pick one model and apply it to all three. EU AI Act's is the right one. This
isn't only a cleanliness issue — the divergence *is* the bug in §2.

### 4.2 Hand-rolled NIST validation vs. Zod everywhere else

`check-owasp-coverage.ts` imports `parseOwaspMapping` and reuses the Zod schema
(`scripts/check-owasp-coverage.ts:23,37`). `check-nist-coverage.ts` re-implements
validation **by hand** — its own `interface Item { …: unknown }`, manual
`typeof`/`includes` checks (`scripts/check-nist-coverage.ts:52-95`). So the NIST
mapping has weaker, separately-maintained validation than its siblings, for no
reason. Give NIST a real schema in `packages/scorecard` (it has no module there
at all — it's the one governance dataset with no parsed/typed representation) and
have its check import it, like OWASP does.

### 4.3 Three near-identical CI check scripts

`check-owasp-coverage.ts`, `check-nist-coverage.ts`, `check-eu-ai-act.ts` share
the same skeleton: `fail()` helper, load+parse JSON, cross-check that the README
mentions every id, print a counts summary. ~340 lines that want to be one
parameterized `checkGovernanceMapping({ jsonPath, readmePath, parse, ids })`
helper plus three ~10-line callers. The README-drift cross-check in particular is
copy-pasted three times.

### 4.4 Band functions are duplicated; headline pyramids are boilerplate

- `guardrailBand` (`scorecard.ts:261-266`) and `governanceBand`
  (`scorecard.ts:311-316`) are **byte-for-byte identical** (`0.9/0.7/0.5`).
  Collapse to one `band(score)` helper. (`reliabilityBand`/`costBand` use
  different thresholds — leave those, or pass thresholds in.)
- Every dimension builder has the same 4-branch `rating === "strong" ? … :
  "adequate" ? … : "at-risk" ? … : …` ternary pyramid for its headline (five
  copies, `scorecard.ts:102-109, 174-181, 229-236, 278-285, 330-337`). This is
  most of why `scorecard.ts` is 462 lines. A `Record<Rating, string>` lookup per
  dimension, or a small `headlineFor(key, rating)` table, removes ~80 lines and
  makes the copy editable in one place.

### 4.5 `cli/src/index.ts` is doing too much (638 lines)

It's the largest file in the repo and mixes command wiring with substantial
inline logic — the `sovereign verify` action alone is ~160 lines of
orchestration + presentation (`index.ts:285-442`), and the `gateway demo` probe-
parsing is another ~50. Commander encourages this, but each subcommand's action
body should be a named function in its own module (`commands/sovereign.ts`, etc.),
leaving `index.ts` as declarative wiring. This also makes the actions unit-
testable; right now they're only reachable through the CLI.

---

## 5. Smaller observations

- **The score is never shown, only the band.** Rendered evidence says "weighted
  coverage 50%" but never the thresholds, so a reader can't see that 50% sits
  right on the at-risk boundary. Consider showing the band cutoffs, or at least
  "50% (at-risk band: 50–69%)". Cheap transparency win, on-brand for a
  "no black box" product.
- **`overallVerdict` worst-band-wins is defensible but unexplained to the
  reader.** The overall headline never says *which* dimension set it. "Not ready
  … the weakest dimension needs work" (`scorecard.ts:403`) should name the
  dimension. One-line change, big clarity gain for an exec.
- **Degraded-mode plumbing via `process.env.RELIABILITY_DEGRADED`**
  (`index.ts:574-576`) is a side-channel into the spawned eval. It's documented
  and works, but it's the kind of global-mutation seam that bites later. Not
  urgent; note it.
- **`content/cycle-10/sample-scorecard.md` is a committed artifact that will go
  stale** the moment §2 lands. Either regenerate it in CI or stop committing
  generated samples (the `.gitignore` already excludes the Production-Readiness
  Assessment artifacts per commit `36b83a2` — apply the same treatment).

---

## 6. What's genuinely good (don't regress these)

- **Pure scoring core.** No clock, no I/O in `scorecard.ts`/`owasp.ts`/
  `eu-ai-act.ts`; timestamps are carried in from the eval result. Deterministic
  and trivially testable. This is the right call and it's done consistently.
- **"Mechanisms, not prose" is real here.** `parseOwaspMapping` makes "every
  threat is classified, every claim names a mechanism, every partial states its
  residual gap" a *failing build*, not a hope (`owasp.ts:50-59,89-100`). The
  README-drift cross-checks are the same instinct. This is the project's best
  idea and it's executed well.
- **Honest stubs.** Unassessed dimensions say so and name the phase that will
  compute them, rather than scoring 0 or faking a number (`scorecard.ts:363-381`).
  The discipline that produced this is exactly what makes the OWASP `gap`
  treatment in §2 stand out as an aberration rather than the norm.
- **Test coverage is broad** (164 tests / 19 files), including the scoring math
  (`owasp.test.ts`), degradation, and air-gap egress. The gap is integration of
  the *built* artifact (§3), not unit coverage.

---

## 7. Prioritized action list

1. **Fix the OWASP applicability model** (§2.3 a–d): add `applicability` to the
   data, score over applicable items, enforce `applicabilityReason` in the Zod
   schema, render out-of-scope items as boundaries not gaps. _Correctness +
   the executive-honesty issue you raised._
2. **Fix the `dist` governance path** and add a built-binary smoke test (§3).
   _Confirmed shipping bug._
3. **Decide band semantics** — adopt the "no true gaps → at least Adequate" floor
   (§2.4). _Product decision; do it deliberately, not by accident._
4. **Unify the three governance modules** on the EU AI Act model, give NIST a real
   schema, and collapse the three check scripts + duplicate band/headline code
   (§4). _Removes the divergence that caused #1; ~250 fewer lines._
5. **Polish:** name the worst dimension in the overall headline, show band
   cutoffs, stop committing generated scorecards (§5).

Items 1–2 are the ones that change what a customer sees. 3 is a judgment call you
should own. 4 is the refactor that stops this class of bug from recurring.
