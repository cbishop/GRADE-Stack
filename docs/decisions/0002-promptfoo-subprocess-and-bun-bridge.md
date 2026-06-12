# ADR 0002 — promptfoo as a subprocess, bridged to Bun/core

- **Status:** Accepted
- **Date:** 2026-06-12
- **Phase:** 1A (Core eval harness)

## Context

Phase 1A makes the naive reference agent measurable with **promptfoo** as the
eval engine (PRD stack table). The PLAN flags a known risk:

> **promptfoo-under-Bun risk note:** promptfoo targets Node. If it misbehaves
> under Bun, invoke the promptfoo CLI as a subprocess rather than re-opening the
> runtime decision. One line in an ADR if this fallback is taken.

Two constraints collide:

1. **promptfoo runs on Node.** Its CLI spawns its own Node runtime; loading our
   Bun/TypeScript packages in-process (which use `.ts` import specifiers and Bun
   APIs) is exactly the misbehaviour the risk note anticipates.
2. **Every model call must flow through `@grade-stack/core`** (a global rule and
   the seam that makes the 2C gateway and 3D air gap structural). promptfoo must
   not open its own path to Bedrock/Ollama.

## Decision

Take the sanctioned fallback, and turn it into the integration architecture:

- `reliability eval run` invokes the **promptfoo CLI as a subprocess**
  (`bun x promptfoo eval … -o <json>`); we parse its JSON output and normalize it
  into our own structured schema. promptfoo's Node runtime stays isolated.
- promptfoo reaches a model only through a **custom provider**
  (`providers/agent-provider.js`, plain Node-loadable ESM) that shells out to a
  **Bun bridge** (`src/bridge.ts`). The bridge is the *only* path from the eval
  harness to a model, and it goes through `@grade-stack/core`. The same provider,
  in `mode: judge`, routes the LLM-as-judge through core too — which is what
  makes the judge swappable to an Ollama judge (a hard Phase 3D prerequisite).

So model code runs on Bun (via core), orchestration runs on Node (promptfoo), and
the two meet at one JSON-over-stdio seam. The harness can never fork its own
model code path.

## Rationale

- **Honours the abstraction structurally**, not by convention — there is exactly
  one bridge file, mirroring the 2C "one seam to the model" rule.
- **Immune to the Node/Bun mismatch** — promptfoo never imports our TS; we never
  run promptfoo's internals under Bun.
- **No runtime re-litigation** — Bun stays the toolchain; promptfoo stays the
  eval engine; the subprocess boundary absorbs the impedance.

## Consequences

- One `bun` process is spawned per model call (agent and judge). Fine at this
  scale (≈12 cases); if it becomes a bottleneck the bridge can be made a
  long-lived server behind the same stdio contract without changing the provider.
- promptfoo's exit code is non-zero when cases fail (exit 100). That is a normal
  result, not a harness error — `runEvalSuite` ignores the exit code and judges
  success by whether parseable output was written. The CLI still exits non-zero
  on a failing suite so Phase 1B CI can gate on it.
- We depend on the shape of promptfoo's JSON output (`results.results[]`,
  `tokenUsage`, `gradingResult.componentResults[]`). A promptfoo upgrade could
  change it; the normalizer is the single place to adjust.
