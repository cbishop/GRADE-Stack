# ADR 0014 — Governance data bundled into the CLI; governance-mapping validation unified

- **Status:** Accepted
- **Date:** 2026-06-25
- **Phase:** Post-mortem remediation (build portability + Phase 3A/3B/3C cleanup)

## Context

Two further post-mortem findings (`docs/post-mortem.md`):

1. **The built binary could not produce a scorecard.** `bun run build` bundles the
   CLI to `dist/index.js`, but the governance mappings were read at runtime from a
   path resolved against `import.meta.url`:
   `new URL("../../../governance/owasp/…json", import.meta.url)`. That path is
   correct from the *source* location (`packages/cli/src/`, three levels below the
   repo root) but overshoots the repo root by two levels once bundled to `dist/`.
   `reliability scorecard` crashed from the built binary with `ENOENT`, while every
   unit test (which runs from source) stayed green. Nothing exercised the bundled
   artifact, so the only shippable form of the CLI was broken and CI was blind.

2. **The three governance checks had drifted.** `check-owasp-coverage.ts`,
   `check-nist-coverage.ts`, and `check-eu-ai-act.ts` were near-identical copies of
   one flow (load JSON → parse → cross-check README → print summary). OWASP and EU
   reused their scorecard Zod schemas; **NIST re-implemented validation by hand**
   (its own `interface Item { …: unknown }`, manual `typeof`/`includes` checks),
   giving the NIST mapping weaker, separately-maintained validation than its
   siblings for no reason.

## Decision

### 1. Bundle the governance JSON into the build (import, don't read from disk)

The CLI now imports the mappings as modules with an import attribute:

```ts
import owaspMappingRaw from "../../../governance/owasp/…json" with { type: "json" };
import euAiActModuleRaw from "../../../governance/eu-ai-act/…json" with { type: "json" };
```

Bun inlines imported JSON into the bundle, so the built binary is **self-contained**
— no runtime path resolution, no dependency on the repo layout, and the scorecard
is reproducible from `dist/` anywhere. The two loaders become synchronous. The
governance mappings are a fixed property of a given build, so compiling them in is
correct, not a workaround.

### 2. A built-binary smoke test (the regression that was missing)

`packages/cli/src/cli.smoke.test.ts` builds the CLI exactly as `bun run build`
does (into a temp dir) and runs `scorecard --from <fixture>` against the artifact,
asserting it exits 0, renders the Guardrail and Governance dimensions (which only
appear if the bundled mappings loaded), surfaces the out-of-scope boundary line,
and never prints `ENOENT`. The bug class — "passes from source, breaks when built"
— is now caught by the test suite.

### 3. One governance-mapping model; NIST gets a real schema; checks collapse to one runner

- **Unified status model.** All three governance modules now express "this item is
  not the stack's to satisfy / not in scope" the same way: a `scored` flag that
  controls denominator inclusion, plus a support/coverage status. EU AI Act had it
  (3C); OWASP adopts it ([ADR 0013](0013-owasp-guardrail-scoring-v2-applicability-and-no-true-gaps-floor.md)); NIST shares the
  `supported/partial/deployer-owned` status it always used.
- **NIST schema.** New `packages/scorecard/src/nist.ts` (Zod schema +
  `parseNistMapping` + `NIST_RMF_IDS`/`NIST_FUNCTIONS`) brings NIST to the same
  validation rigor as OWASP/EU and is unit-tested (`nist.test.ts`). NIST remains a
  standalone procurement artifact, not a scorecard dimension — the module
  validates structure and completeness but computes no rating.
- **One check runner.** New `scripts/check-governance-mapping.ts` owns the shared
  load/parse/README-cross-check/summary flow; the three `check-*` scripts are now
  thin specs that pass their parser, the README tokens that must be present, and a
  summary builder. The "no silent omissions / no machine-human drift" mechanism is
  defined once.

### 4. Smaller scorecard cleanups carried in the same change

- The two byte-identical band functions (`guardrailBand`, `governanceBand`) are
  one `standardBand`; the five per-dimension headline ternary-pyramids are
  `Record<Rating, string>` lookup tables (strings preserved verbatim).
- The overall verdict now **names the dimension that set it** ("Weakest dimension:
  …"), and the guardrail evidence states the band thresholds inline — both for
  reader clarity (post-mortem §5).

## Consequences

- The shippable artifact works: `bun dist/index.js scorecard` produces a full
  five-dimension readout offline, proven by a test that runs on every `bun test`.
- NIST validation is no longer the weak sibling; a malformed NIST mapping fails the
  same way OWASP/EU do, through a typed schema.
- ~250 lines of duplicated check-script and headline/band code removed; the
  governance checks share one runner, so the next governance module is a spec, not
  a copy.
- New enforcement-register-relevant fact: the **built CLI** is now covered by a
  smoke test (added to the verification list in the plan).

## Alternatives considered

- **Compute the governance path from a repo anchor (walk up to a marker file).**
  Rejected — still does runtime disk I/O and assumes the data ships next to the
  binary; bundling removes the failure mode entirely.
- **Only fix the path; skip the smoke test.** Rejected — the root cause was *no
  test of the built artifact*. Without the test, the next bundling regression
  ships the same way.
- **Leave NIST's hand-rolled check (it works).** Rejected — it works *and* is
  weaker and divergent; the post-mortem flagged exactly this kind of "copy that
  drifted in correctness." One model, one runner.
