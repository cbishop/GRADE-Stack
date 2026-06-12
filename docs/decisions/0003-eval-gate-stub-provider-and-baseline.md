# ADR 0003 — CI eval gate: deterministic stub provider + committed baseline

- **Status:** Accepted
- **Date:** 2026-06-12
- **Phase:** 1B (CI gating + cost-per-success)

## Context

Phase 1B turns the eval suite into an enforcement mechanism: a PR that degrades
agent quality below threshold must be **blocked by CI automatically**. Three
things collide:

1. **The acceptance test needs a passing baseline to degrade from.** The Phase 1A
   finding is that the naive agent scores **0/12 on Bedrock** (it fences JSON in
   ` ```json `; not fixed until Phase 2A) and **12/12 on Ollama**. A
   Bedrock-backed gate has nothing to regress *from* until 2A.
2. **GitHub Actions does not expose repo secrets to fork PRs**, so a Bedrock gate
   (AWS creds) can never run on forks — and the bar is "a fork PR must not be
   mergeable ungated."
3. **Ollama-in-CI is heavy** — a multi-GB model pull per run (or a self-hosted
   runner, which is an attack surface on a public repo). The PLAN flags it as the
   fallback-only option (task 3b).

A gate must be **deterministic** (no flaky failures), **cheap** (no unbounded
spend), and **fork-safe** (no secrets). None of the real-provider paths are all
three today.

## Decision

The CI eval gate runs against a new **deterministic `stub` provider**
(`packages/core/src/providers/stub.ts`) — a hermetic `ModelProvider` with no
network, no credentials, and no cost. It plugs into the exact same provider seam
as Bedrock/Ollama (so it flows through the agent *and* the LLM-as-judge
unchanged) and returns canned, deterministic output: valid triage JSON keyed off
the email for the agent, and a passing promptfoo `llm-rubric` verdict for the
judge.

- **Baseline mechanism:** a committed `packages/evals/baseline.stub.json`
  (a full `EvalRunResult`) on `main`. `reliability eval gate` runs the suite and
  compares against it **on pass rate within the 1A ±1-case tolerance band**
  (`packages/evals/src/gate.ts`). Rate-based comparison keeps the gate valid for
  a PR *smoke* subset as well as the full suite. The baseline is updated only by
  an explicit, reviewed re-baseline commit.
- **Regression threshold:** `passRate < baselinePassRate − (1 / baselineTotal)`
  fails the build. `--degraded` collapses the agent to 0/12, which is far below
  the floor → the gate fails and CI blocks the PR.
- **CI cost cap:** `--max-cost` fails the run if total spend exceeds a cap
  (\$0 for the stub; the mechanism is in place for when a real provider is added).
  PRs run a smoke subset (`--first-n 6`), pushes to `main` run the full suite.

**This gate proves the *mechanism* blocks a regression, not that the *real model*
regressed.** Real-model quality is measured locally on Bedrock/Ollama (and shows
up in the cost-per-success numbers). The README/scorecard must not imply CI
measures real-model quality.

## Rationale

- **Only option that satisfies the acceptance test today** — Bedrock is 0/12
  until 2A; Ollama-in-CI is the explicit last resort.
- **Deterministic → no flake.** The tolerance band exists for provider
  nondeterminism; the stub has none, so the gate is rock-solid and the
  degraded-mode demonstration is crisp and reproducible.
- **Fork-safe and free** — no secrets, no spend, fast PR feedback; it also makes
  the cost-cap task trivially satisfiable now and real later.

## Consequences

- The gate tests the harness, not the model. We accept that bounded trade-off for
  Phase 1B and close it in 2A.
- **Revisit in Phase 2A:** once 2A fixes Bedrock JSON extraction, add a
  real-Bedrock eval job on `main`/nightly so CI also watches the production model
  path. Until then CI gates the stub only.
- A second code path (the stub provider) exists purely for the gate; it is small,
  pure, and unit-tested, and doubles as a fast fake for agent tests.
