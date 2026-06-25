# The sovereign / on-prem variant (air-gapped)

Some mid-market buyers — regulated, public-sector, defence-adjacent, or simply
data-sovereignty-bound — cannot send prompts to a cloud model at all. GRADE-Stack
runs the **whole pipeline on a local model** for them: the reference agent, the
eval harness, and the scorecard, with **nothing leaving the machine**.

This is the same stack, not a fork. The seams that make it possible were built in
earlier phases on purpose:

- **One provider abstraction** (Phase 0) — swap Bedrock for **Ollama** with a flag.
- **Portable judge** (Phase 1A) — no eval metric depends on a cloud LLM-as-judge,
  so grading runs on the local model too.
- **Gateway in front of the model** (Phase 2C) — runs locally in front of Ollama;
  credential isolation holds even with networking severed.
- **Opt-in tracing** (Phase 2D) — OTLP export is off by default, so there is no
  cloud dependency to disable.

## "No cloud dependency" is a mechanism, not a claim

Per this repo's core principle, the air gap is **enforced**, not asserted. When
`RELIABILITY_AIRGAP=1` is set, an **egress guard** (`@grade-stack/core`
`src/airgap.ts`) wraps `fetch` so any call to a **non-loopback host throws**
`EgressBlockedError`. Loopback — `localhost`, `127.0.0.0/8`, `::1` — is the only
allowed destination, so the local Ollama and gateway work while an accidental
cloud call fails *loudly* instead of silently leaving the box.

It is the network-seam twin of the Phase 2C credential isolation:

| Seam | Mechanism | Covers |
|---|---|---|
| Network | Egress guard — `fetch` to non-loopback throws | Ollama provider, gateway client, OTLP HTTP exporter |
| Credentials | Sandbox env strips creds; gateway is sole path (2C) | The AWS SDK (separate transport; fails for lack of creds) |

The two compose: the guard catches `fetch`-based egress; a direct Bedrock call
(AWS SDK, not `fetch`) is caught air-gapped by having no credentials. The guard is
**off by default** (`installEgressGuardFromEnv` is a no-op when unset), so the CI
eval gate and the normal cloud path are untouched. See
[ADR 0012](decisions/0012-airgap-egress-guard-and-sovereign-variant.md).

## Run it

Prerequisite: [Ollama](https://ollama.com) running locally with the default model
pulled (`gemma4:12b-mlx`, or set `RELIABILITY_OLLAMA_MODEL`).

```bash
# Prove the full pipeline runs with no cloud dependency:
bun run reliability sovereign verify

# Also prove the gateway + credential isolation hold air-gapped (Phase 2C):
bun run reliability sovereign verify --gateway

# Faster smoke run (first N eval cases); attach an amortized hardware rate:
bun run reliability sovereign verify -n 3 --amortized 1.20
```

`sovereign verify` arms the guard and then proves, in order:

1. **the guard is live** — a call to a cloud canary host is blocked (not merely
   "the guard is installed", but *it actually refuses egress*);
2. **the local model is reachable** over loopback;
3. **the agent runs** on the local model;
4. **the eval suite runs** — its promptfoo→bridge subprocess inherits the air gap,
   and grading uses the **Ollama judge**;
5. **the scorecard generates** offline;
6. **cost-per-success** reports in the local-model semantics (below).

It exits non-zero if any proof fails, so it is CI-gateable. Every command honors
`RELIABILITY_AIRGAP=1` — `sovereign verify` is just the orchestrated proof.

### Independent confirmation: actually sever the network

The egress guard polices this stack's own `fetch` calls. A skeptic can fairly ask
whether *something else* reaches out. The strongest independent check is to remove
the network entirely and confirm the pipeline still completes — a deployer or
auditor can reproduce this:

```bash
# macOS — turn Wi-Fi off, then run on loopback-only:
networksetup -setairportpower en0 off
bun run reliability sovereign verify   # Ollama + gateway are loopback; still exits 0
networksetup -setairportpower en0 on

# Or, fully sandboxed (Linux): run under a network namespace with only `lo` up,
# e.g. `unshare -n` / a `--network none` container, with Ollama bound to 127.0.0.1.
```

The guard is the *committed, CI-gateable* mechanism; the network-off run is the
*real-world confirmation* that nothing outside this stack's `fetch` reaches out
either. Both should pass.

## Cost / effort trade-off (directional, not a guarantee)

Self-hosting trades a per-token cloud bill for fixed hardware and materially more
engineering effort. The honest framing for a mid-market buyer:

**Token cost.** Local inference has **no per-token dollar cost** — `sovereign
verify` reports cost-per-success on the Ollama semantics from Phase 1B: token
counts always, dollars default to **\$0**, with an **optional amortized
hardware rate** (`--amortized <usd-per-MTok>` / `RELIABILITY_OLLAMA_USD_PER_MTOK`).

Real numbers from an air-gapped run of the full 12-case suite on `gemma4:12b-mlx`
(M4 Mac Studio), 2026-06-24:

| | Sovereign (Ollama, local) | Cloud (Bedrock Haiku 4.5, list price) |
|---|---|---|
| Eval pass rate | 11 / 12 (stability 1.00) | 11 / 12 (Phase 2A) |
| \$/success — default basis | **\$0** | — |
| \$/success — amortized \$1.20/MTok | ≈ **\$0.0017** (≈1,423 tokens/success) | — |
| \$/success — cloud list price | — | ≈ **\$0.005** (directional)¹ |
| Where the money goes | fixed hardware + ops effort | metered per token |

¹ Directional only: applies Bedrock Haiku 4.5 list price (\$1/\$5 per MTok in/out,
`packages/evals/src/pricing.ts`) to a representative token volume — not a matched
same-prompt run. Cloud and local token counts differ.

**The trade-off, honestly.** Self-hosting only pencils out **above meaningful token
volume**: the amortized per-success cost falls as you spread fixed hardware over
more calls, while the cloud bill scales linearly. Below that crossover the cloud is
cheaper *and* far less work. And the effort is real — you own the model lifecycle,
GPU/host capacity, upgrades, and on-call. For most mid-market teams the cloud path
is right; the sovereign variant exists for the buyers whose **data cannot leave the
boundary at any price**, where the question isn't cost-per-success but
"can this run at all without egress?" — and here, it provably can.

**Quality.** The smaller local model is weaker: the one eval miss is a
`validate:judge` (LLM-rubric) case where it over-promises in the draft reply — a
quality gap, not a reliability-mechanism gap (schema validation, turn bounds,
guardrails all hold). Larger local models narrow this at higher hardware cost.
