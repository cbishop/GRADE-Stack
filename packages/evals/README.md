# @grade-stack/evals

The eval harness: it makes the naive reference agent **measurable** (Phase 1A)
and turns that measurement into an **enforcement gate + an executive-legible
cost metric** (Phase 1B). A starter suite of 12 support-email triage cases runs
through [promptfoo](https://promptfoo.dev), scores each case along the
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

# The CI gate: run the suite and fail (exit 1) on a regression vs the baseline.
# Defaults to the deterministic `stub` provider used in CI (no secrets, no spend):
bun run reliability eval gate

# See the gate block a regression (degraded mode collapses the agent to 0/12):
RELIABILITY_DEGRADED=1 bun run reliability eval gate   # → FAIL, exit 1
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

## The eval gate (Phase 1B)

`reliability eval gate` turns the suite into an enforcement mechanism: it runs
the suite, compares against a **committed baseline within the ±1-case tolerance
band**, and **exits non-zero on a regression** so CI blocks the PR.

- **Deterministic by design.** The gate runs against the `stub` provider — a
  hermetic, network-free, credential-free `ModelProvider` that returns canned
  output and a passing judge verdict. It proves the *mechanism* blocks a
  regression, reproducibly and for free. Real-model quality is measured locally
  on Bedrock/Ollama (and surfaces in the cost numbers below). A real-Bedrock job
  on `main` is added in Phase 2A. See
  [ADR 0003](../../docs/decisions/0003-eval-gate-stub-provider-and-baseline.md).
- **Baseline:** `baseline.stub.json`, a committed full `EvalRunResult`. Re-baseline
  only via a reviewed commit:
  `reliability eval run --provider stub --out packages/evals/baseline.stub.json`.
- **Demonstration:** the agent's `--degraded` mode (`RELIABILITY_DEGRADED=1`)
  drops the structured output contract, collapsing the suite to 0/12 — well below
  the floor — so the gate fails. Degraded mode is retained as a permanent canary.
- **Cost cap:** `--max-cost <usd>` fails a run whose total spend exceeds the cap
  (\$0 for the stub; real for Bedrock later). PRs run a 6-case smoke subset
  (`--first-n 6`); pushes to `main` run the full suite.
- **Fork PRs:** the gate runs on same-repo PRs and `main`; fork PRs run it only
  after a maintainer applies the `eval-approved` label, and the gate is a required
  status check so a fork PR can't merge ungated. See
  [ADR 0004](../../docs/decisions/0004-fork-pr-eval-strategy.md).

## Cost-per-success (Phase 1B)

Cost is counted per **passing** outcome, not per call — a cheap agent that fails
is not cheap. `reliability eval run` reports it on every run:

```
cost-per-success: $0.00042  (1830 tokens/success)
  total $0.00504 on bedrock/...claude-haiku-4-5... — list price
```

- **Token counts are always reported**, on every provider.
- **Dollars** follow per-provider pricing (`src/pricing.ts`): Bedrock uses
  published list prices (Haiku 4.5 \$1/\$5 per MTok, Sonnet 4.6 \$3/\$15,
  verified 2026-06-12); **Ollama defaults to \$0**, with an optional amortized
  hardware rate via `RELIABILITY_OLLAMA_USD_PER_MTOK` (feeds the Phase 3D
  sovereign trade-off). The `stub` provider is \$0.
- **Semantics on both providers:** cost-per-success is `null` (shown `n/a`) when
  no case passes — it's undefined, not zero.

## Loop bounding (Phase 1B)

The reference agent runs inside an **enforced** turn bound (`--max-turns`,
default 4; `RELIABILITY_MAX_TURNS`). The naive agent converges in one turn; the
bound is structural so the Phase 2A planner/executor/validator loop cannot run
away — exceeding it throws `MaxTurnsError` rather than looping. `--max-turns 0`
fails before any model call, demonstrating the bound is enforced, not suggested.

## Layout

```
promptfooconfig.yaml        the 12-case suite + phase-tagged assertions
providers/agent-provider.js promptfoo custom provider (Node ESM) -> Bun bridge
baseline.stub.json          committed stub baseline the gate compares against
src/bridge.ts               Bun entrypoint; the one path to @grade-stack/core
src/run.ts                  spawn promptfoo, normalize its JSON to our schema
src/gate.ts                 tolerance-banded regression gate (pure)
src/pricing.ts              per-provider pricing + cost-per-success
src/format.ts               human-readable CLI summary + gate verdict
src/types.ts                EvalRunResult / CaseResult / TraceStep schema
src/run.test.ts             unit tests for the pure normalization logic
src/gate.test.ts            gate regression + cost-cap + smoke-subset tests
src/pricing.test.ts         pricing + cost-per-success tests
```
