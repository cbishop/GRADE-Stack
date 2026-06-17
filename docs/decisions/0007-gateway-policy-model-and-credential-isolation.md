# ADR 0007 — Gateway policy model + structural credential isolation

- **Status:** Accepted
- **Date:** 2026-06-17
- **Phase:** 2C (LLM gateway / guardrails)

## Context

Phase 2C requires a gateway that "sits between agent and models, enforcing
policy **server-side**," with **credential isolation** as the structural
mechanism — "the agent process targets only the gateway endpoint and holds no
Bedrock/Ollama credentials; the gateway alone holds provider access. Without
this, the gateway is routable-around in code — prose, not a mechanism." The
acceptance contract demands two proofs: a guardrail blocked at the gateway **even
under a bypass-attempt prompt** (behavioral), and a direct-to-provider call from
the agent process **failing for lack of credentials** (structural).

Two design questions had to be resolved:

1. **Where does the client/server seam live, and what crosses it?** Earlier ADRs
   (0005, 0006) deliberately kept `ModelProvider.generate` **text-in / text-out**
   so the gateway and the 3D air gap could be inserted without retrofitting every
   call site. 2C is where that seam pays off.
2. **How is "the agent holds no credentials" made a mechanism rather than a
   convention?** A guard in feature code is prose; the property has to hold by
   construction.

## Decision

**The gateway is a separate, credential-holding HTTP process.** `@grade-stack/gateway`
runs a `Bun.serve` server exposing a single `POST /v1/generate` endpoint. It is
the only process that constructs a credentialed provider (via core's
`createDirectProvider`). The agent talks to it through `GatewayProvider`, a
`ModelProvider` that holds **no** credentials and only POSTs to the gateway. The
client seam and wire contract live in `@grade-stack/core`, **not** in the gateway
package, so the agent bundle can never transitively import a provider SDK or
credentials.

**Guardrails are pure, deterministic, server-side functions** (`gateway/policy.ts`),
applied around every model call by `GatewayService` with no path to the model
that skips them. Four guardrails:

- **Prompt-injection / override denial** (input) — regex detection of
  instruction-override / jailbreak attempts, independent of the agent's own
  system prompt (the point of enforcing server-side).
- **Secret-exfiltration denial** (input **and** output) — literal secret material
  (AWS keys, private-key blocks, API-key assignments) and exfiltration *intent*
  ("email me the API keys") are refused on the way in; secret-bearing model
  output is refused on the way out. Violation reasons never echo the secret.
- **Output PII redaction** — SSNs and Luhn-valid card numbers are redacted in
  place (the answer still flows, minus the sensitive spans); a Luhn check keeps
  invoice/order numbers from being over-redacted.
- **Token + model caps** — requests over the `maxTokens` cap are blocked, and an
  optional model allowlist pins which models may be called.

A guardrail block is returned as HTTP **422** with a structured
`{ ok: false, violation }` body; `GatewayProvider` raises it as a `GuardrailError`
the agent cannot suppress.

**Credential isolation is enforced by construction.** A credential-isolated agent
process is marked with `RELIABILITY_AGENT_SANDBOX=1`. In that mode the core
factory will hand back **only** a gateway-backed provider for `bedrock`/`ollama`
— a missing `RELIABILITY_GATEWAY_URL` is a hard error, never a silent direct
fallback — and `createDirectProvider` **refuses to run at all**. The
`isolatedAgentEnv` helper additionally strips every AWS credential variable and
dead-ends ambient credential files / IMDS, so a raw `new BedrockProvider().generate()`
from that process fails on credentials, fast and offline. The
`isolation-probe` program, spawned with that env, demonstrates both proofs and is
asserted in a test (`gateway.test.ts`) and shown live by `reliability gateway demo`.

**Gateway routing is the default for real providers** (the plan's "sole model
path from 2C"): when a gateway URL is configured, `bedrock`/`ollama` calls route
through it automatically — no per-run flag. `RELIABILITY_GATEWAY=off` is a
local-dev escape back to the direct provider (only honoured when **not**
sandboxed). The hermetic **`stub`** provider is always direct, so the CI eval gate
(ADR 0003) and its committed baseline are untouched by 2C.

## Rationale

- **Server-side, not prompt-side.** Because the policy runs in the gateway
  process, manipulating the agent's prompt cannot disable it — the bypass-attempt
  prompt is blocked at the gateway, which is the behavioral proof.
- **Structural, not advisory.** The sandbox makes the gateway un-routable-around:
  the agent process has no factory path to a credentialed provider and no
  credentials to authenticate one. The direct-call failure is the structural
  proof, and it holds offline and deterministically (the factory guard) as well
  as in reality (no AWS credentials).
- **The text seam stays narrow** (consistent with ADRs 0005/0006): the gateway
  forwards an ordinary `GenerateRequest` and returns a `GenerateResult`, so the
  2D tracing and 3D air-gap work sit on the same seam — the 3D gateway simply
  runs locally in front of Ollama, and credential isolation still holds.

## Consequences

- Real-provider runs (`agent run -p bedrock`, real-provider eval/scorecard) now
  expect a running gateway (`reliability gateway serve`); `RELIABILITY_GATEWAY=off`
  remains for raw local dev. The deferred real-Bedrock CI job (noted in 1B) will
  point at the gateway, not the provider directly.
- Guardrails are intentionally **deterministic regex/Luhn**, not an LLM filter:
  cheap, reproducible, unit-testable per rule, and air-gap-safe. The trade-off is
  recall — a model-based classifier would catch more paraphrases. The policy
  surface (`GatewayPolicy`, the pattern tables) is the place to harden later
  without touching the seam.
- PII is **redacted** while secrets are **blocked** — a deliberate asymmetry: a
  redacted reply is still useful, whereas a leaked credential is a breach.
