# ADR 0012 — Air-gap egress guard: "no cloud dependency" as a mechanism, not a claim

- **Status:** Accepted
- **Date:** 2026-06-24
- **Phase:** 3D (Sovereign / on-prem variant)

## Context

Phase 3D ships the **sovereign / on-prem variant**: the full pipeline (agent →
evals → scorecard) running entirely on a local model (Ollama on the M4 Mac
Studio), with **zero cloud dependency**. The plan's acceptance criterion is that
the pipeline "runs with networking disabled."

This repo's core principle is **mechanisms, not prose**: a "must never" is
enforced by a hook, schema, or gate — never a sentence. "No cloud dependency" is
exactly such a claim, and the easy version of this phase would have been a
README paragraph and a screenshot. That binds nobody and silently rots the first
time a dependency reaches out.

Two questions: how to *enforce* the air gap as a checkable mechanism, and where
that mechanism sits relative to the Phase 2C credential isolation it builds on.

## Decision

### 1. An in-process egress guard, armed by one env var

`@grade-stack/core` `src/airgap.ts` wraps `globalThis.fetch` so that, under
`RELIABILITY_AIRGAP=1`, any call to a **non-loopback host** throws
`EgressBlockedError`. Loopback — `localhost`, `127.0.0.0/8`, `::1` — is the only
allowed destination, so the local Ollama and the local gateway keep working
while an accidental cloud call (Bedrock, a cloud OTLP endpoint, a tool that
phones home) **fails loudly instead of silently leaving the box**.

The guard is the network-seam analogue of Phase 2C's credential seam
(`gateway/sandbox`): a pure host predicate (`isLoopbackHost`) plus a `fetch`
wrapper (`createGuardedFetch`), installed at each process entry point from the
env (`installEgressGuardFromEnv`). It is installed at the CLI entry, the eval
**bridge** (where model calls actually happen), and the isolation probe. Because
the eval harness propagates `process.env` down its promptfoo → bridge spawn
chain, **setting the env once air-gaps every process that makes a model call** —
no per-process wiring.

### 2. The guard covers `fetch`; credential isolation covers the rest

The guard polices `fetch`-based egress: the Ollama provider, the gateway client,
the OTLP HTTP exporter. The **AWS SDK uses a separate transport** and is *not*
routed through `fetch`, so the guard would not catch a direct Bedrock call. That
gap is closed air-gapped by **Phase 2C credential isolation** (ADR 0007): a
direct Bedrock call has no credentials to authenticate with and fails. The two
mechanisms compose — egress guard for `fetch`, credential isolation for the SDK
— and `sovereign verify --gateway` proves the credential half holds with the
guard armed. The promptfoo subprocess is outside our `fetch` wrapper, so under
air-gap mode the harness also sets `PROMPTFOO_DISABLE_TELEMETRY` /
`_UPDATE` / `_SHARING` / `_REMOTE_GENERATION`.

### 3. `reliability sovereign verify` is the orchestrated proof

A single command arms the guard, then proves, in order: the guard actually
blocks a cloud canary (the mechanism is *live*, not merely present); the local
model is reachable over loopback; the agent runs; the eval suite runs (its
subprocess inheriting the air gap, using the **Ollama judge** — the 1A
judge-portability requirement is what makes this possible); the scorecard
generates; and cost-per-success reports in the **1B Ollama semantics** (tokens
always; dollars default to \$0, amortized only with an explicit rate). It exits
non-zero if any proof fails, so it is CI-gateable.

### 4. Off by default — the CI gate and cloud paths are untouched

`RELIABILITY_AIRGAP` is unset by default; `installEgressGuardFromEnv` is a no-op
then. Like the 2C gateway routing and the 2D OTLP export, the air gap is opt-in,
so the deterministic stub CI eval gate and the normal Bedrock path are unaffected
by construction.

## Consequences

- "No cloud dependency" is now a **mechanism**: a fetch to any remote host throws,
  proven live by a canary, and the proof is one CI-gateable command.
- A real air-gapped run on Ollama: **11/12** eval cases pass (stability 1.00, the
  one miss a `validate:judge` case on the smaller local model, consistent with
  Phase 2A), scorecard generates offline, gateway/credential isolation holds.
  Overall verdict stays **At risk**, driven by Guardrail coverage (3A) — a
  property of the stack's mechanisms, not of which model answered.
- The guard is host-based: it blocks a *determinable* remote host. A relative or
  unparseable fetch target has no host to police and passes through to the
  underlying fetch (which resolves or fails it). This is a deliberate boundary,
  documented in `docs/sovereign-on-prem-variant.md`.

## Alternatives considered

- **A README paragraph + a screenshot of `--network none`.** Rejected — prose,
  not a mechanism; rots silently. The OS-level network-off run is still
  *documented* in the sovereign doc as an independent, reproducible confirmation a
  deployer or auditor can run, but it is not the binding mechanism.
- **Patch Node's `http`/`https` modules too, to catch the AWS SDK.** Rejected as
  unnecessary and invasive — credential isolation (2C) already makes a direct
  Bedrock call fail air-gapped; the two mechanisms compose without it.
- **A new `packages/sovereign`.** Rejected — the guard is a property of the
  network seam, which `@grade-stack/core` already owns; no new package earned its
  keep (cf. the 3A/3C governance logic staying in existing packages).
