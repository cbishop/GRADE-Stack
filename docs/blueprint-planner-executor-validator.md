# Blueprint — the Planner / Executor / Validator agent pattern

> **Status:** Phase 2A deliverable. The reusable shape for a mid-market agent.
> Reference implementation: `@grade-stack/core` (`src/pev.ts`) wired by
> `reference-agent` (`src/agent.ts`).

A reliable agent is not "a model with a good prompt." It is a small **loop with a
contract**: something decides the approach, something calls the model, and
something **refuses output that doesn't meet a schema** — and the loop is bounded
so it can't run forever. That is the Planner → Executor → Validator (PEV)
pattern. It is the default we recommend for a company *without* an ML-platform
team: three named responsibilities, one enforced contract, one turn bound.

## The three roles

| Role | Owns | Makes a model call? |
|---|---|---|
| **Planner** | Decides the approach and shapes the prompt around the **schema contract**. On a retry, folds the validator's complaints back in as repair instructions. | No — planning is deterministic, so *turns == executor calls*. |
| **Executor** | Turns one plan into exactly one model call through the provider abstraction. | Yes — one call per attempt. |
| **Validator** | Extracts the result and **enforces the schema**: conforming output is accepted, anything else is rejected with reasons. | No. |

The loop: **plan → execute → validate**. If validation fails, the planner
**re-plans** with the failure reasons and the executor tries again — up to an
**enforced turn bound** (`MaxTurnsError`, never an infinite spin; Phase 1B). A run
that never conforms throws rather than returning junk.

```
            ┌─────────── re-plan with validator feedback ───────────┐
            │                                                        │
   input ──▶ PLAN ──▶ EXECUTE (1 model call) ──▶ VALIDATE ──┬─ ok ─▶ value
            ▲                                               │
            └────────────────── fail (≤ maxTurns) ──────────┘
                              exhausted ▶ MaxTurnsError
```

## The contract is the mechanism, not the prompt

The Validator does **not** trust the prompt to have produced good JSON. It parses
the model's output against a **Zod schema** (`TriageSchema`) and rejects anything
that doesn't conform — wrong enum value, missing field, empty string, prose with
no JSON. The schema — code that *rejects* — is the enforcement; the prompt only
*requests*. See **[ADR 0005](decisions/0005-validator-structured-output-via-zod-schema-parse.md)**
for why this is a Zod schema-parse rather than provider-native tool-use.

Two things fall out of that for free:

- **Robust extraction.** Real models (Claude on Bedrock) fence JSON in
  ` ```json … ``` `. The validator strips fences and falls back to the first
  `{ … }` span before parsing. This is the Phase 1A finding's deferred fix — and
  it took the Bedrock suite from **0/12 → 11/12** with no other change.
- **A real repair loop.** A rejected attempt is not a dead end: its reasons
  become the next plan's instructions, so the agent can self-correct within the
  turn bound instead of failing the case outright.

## Reusing it for another task

The loop, the bound, the trace, and the `zodValidator` are **generic** and live
in core. To build a different agent you supply three task-specific pieces:

1. A **Zod schema** for the output (your contract).
2. A **`Planner<Input, Plan>`** — pure function from input (+ prior issues) to a
   prompt. No model call.
3. An **`Executor<Plan>`** — one `provider.generate(...)` call.

Then:

```ts
import { runPEV, zodValidator } from "@grade-stack/core";

const validator = zodValidator(MySchema);                 // contract + JSON Schema
const planner   = makeMyPlanner(validator.jsonSchema);    // told the exact shape
const executor  = makeMyExecutor(provider);               // one model call

const result = await runPEV(input, planner, executor, validator, { maxTurns: 4 });
// result.value is schema-valid; result.steps is the plan/execute/validate trace.
```

`reference-agent/src/agent.ts` is the worked example (support-email triage).

## How it maps onto the eval trace (Phase 1A → 2A)

Phase 1A shaped the eval schema around three phases — `plan` / `execute` /
`validate` — *before* the agent had them, so the trace would survive this
refactor. It does, 1:1:

- The eval attributes each promptfoo assertion to a phase by its metric prefix
  (`validate:json-valid`, …; unprefixed defaults to `validate`) — see
  `packages/evals/src/run.ts` (`phaseOf`).
- The agent now emits the **same three phases** as an `AgentStep[]` trace
  (`result.steps`): one `plan`/`execute`/`validate` triple per attempt.

So the per-case eval trace and the agent's own execution trace describe the same
plan → execute → validate spine. The 1A trace-level scoring still maps; the only
change is that `plan` and `validate` are now genuinely distinct steps rather than
placeholders. (Today's suite still concentrates its assertions on the `validate`
phase — the `· plan` marker means "no checks for this phase yet," not "no plan
step"; richer plan-phase assertions can be added without reshaping anything.)

## Why this shape, for this audience

- **Legible to a non-ML team.** Three named jobs and one schema beat a 300-line
  prompt nobody can reason about.
- **Failure is contained.** A bad model response is rejected and retried, or the
  bounded loop fails loudly — it never silently returns malformed output or spins
  forever.
- **It composes with the rest of the stack.** The same schema feeds the eval
  contract; the same provider seam will sit behind the 2C gateway; the bound is
  already the runaway-loop mechanism from 1B.
