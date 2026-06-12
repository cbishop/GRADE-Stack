# @grade-stack/evals

The Phase 1A eval harness: it makes the naive reference agent **measurable**.
A starter suite of 12 support-email triage cases runs through
[promptfoo](https://promptfoo.dev), scores each case along the
planner/executor/validator path, and emits structured JSON.

## Run it

```bash
# Local model (free, offline). Agent + judge both on Ollama:
bun run reliability eval run --provider ollama

# Production path on Bedrock; write structured JSON too:
bun run reliability eval run --provider bedrock --out results.json

# Measure flakiness: run each case 3 times and report per-case stability:
bun run reliability eval run --provider ollama --repeat 3

# Mixed: Bedrock agent graded by a local Ollama judge (judge portability):
bun run reliability eval run --provider bedrock --judge-provider ollama

# Machine-readable results to stdout:
bun run reliability eval run --provider ollama --json
```

Or the `/eval-run` slash command in Claude Code.

## How it fits together

Every model call — the agent under test **and** the LLM-as-judge — flows through
the `@grade-stack/core` provider abstraction. promptfoo runs on Node, our code
runs on Bun, and they meet at one JSON-over-stdio seam:

```
reliability eval run
  └─ spawns: promptfoo eval (Node)                  orchestrates cases + assertions
       └─ custom provider providers/agent-provider.js (Node ESM)
            └─ spawns: src/bridge.ts (Bun)          the ONE path to a model
                 └─ @grade-stack/core               Bedrock | Ollama
```

See [ADR 0002](../../docs/decisions/0002-promptfoo-subprocess-and-bun-bridge.md)
for why promptfoo is a subprocess and the model path is bridged to Bun.

## The suite

`promptfooconfig.yaml` holds 12 cases spanning the real input distribution:
billing, technical, account, mixed, positive-feedback, plus the required
**edge cases** — an empty body, an out-of-distribution spam email, and a
**refusal** case (a request to exfiltrate another customer's data, which the
agent must not satisfy or fabricate).

Each case is scored by phase-prefixed assertions, which the CLI groups into a
planner / executor / validator trace (not just a final pass/fail):

| Phase | Checks (metric prefix) |
|---|---|
| `plan` | *(none yet — the naive agent has no planner; reads `· skipped` until Phase 2A)* |
| `execute` | `execute:responded` — the agent produced output |
| `validate` | `validate:json-valid`, `validate:fields`, `validate:enums`, `validate:category`, `validate:sentiment`, and the LLM judge `validate:judge` / `validate:judge-safety` |

The trace schema is deliberately shaped around all three phases now so it
survives the Phase 2A refactor that makes the planner and validator explicit.

## Reproducibility & tolerance

Bedrock has **no seed parameter**, so bit-identical output is not achievable and
is not the bar. We pin determinism where the provider allows it (`temperature: 0`
on both the agent and the judge) and judge stability with a **tolerance band**.

**Definitions**

- **Per-case stability** = the fraction of `--repeat` runs whose pass/fail
  agreed with the majority outcome. `1.00` = perfectly stable. Reported per case
  and as a suite mean.
- **Aggregate tolerance band** = **±1 case (≈ ±8 percentage points** on a
  12-case suite). Two consecutive full runs are considered to agree if their
  pass counts differ by no more than one case. Phase 1B's CI gate compares
  against the committed baseline within this same band so nondeterminism cannot
  flake the build.

**What we observed at build time (2026-06-12)**

| Provider | Determinism | Observed |
|---|---|---|
| **Ollama** (`llama3.1`, temp 0) | Effectively deterministic locally | `--repeat 3`: every case `stability = 1.00`; two full runs both 12/12. |
| **Bedrock** (`claude-haiku-4-5`, temp 0) | No seed; minor wording variation possible | Pass/fail outcomes stable across runs on this suite; aggregate within the ±1-case band. |

**A real finding, left unfixed on purpose.** The same naive agent scores
**12/12 on Ollama but 0/12 on Bedrock** — Claude Haiku wraps its JSON in a
` ```json ` markdown fence, so the agent's *raw* output isn't valid JSON and the
validator correctly fails it. The agent does no extraction (it's the documented
"before" state). This is exactly the kind of gap eyeballing one happy-path run
would miss and measurement catches. Phase 1A only **measures**; output
extraction and a schema-enforced validator arrive in Phase 2A — the agent is not
patched to make cases pass here.

## Layout

```
promptfooconfig.yaml        the 12-case suite + phase-tagged assertions
providers/agent-provider.js promptfoo custom provider (Node ESM) -> Bun bridge
src/bridge.ts               Bun entrypoint; the one path to @grade-stack/core
src/run.ts                  spawn promptfoo, normalize its JSON to our schema
src/format.ts               human-readable CLI summary
src/types.ts                EvalRunResult / CaseResult / TraceStep schema
src/run.test.ts             unit tests for the pure normalization logic
```
