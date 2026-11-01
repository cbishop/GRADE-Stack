# ADR 0015 — Agent identity, session revocation, and the kill switch

- **Status:** Proposed (design accepted at planning time; to be confirmed as each Phase 4 sub-phase lands)
- **Date:** 2026-08-12
- **Phase:** 4 (runtime control — see [`docs/PLAN-Phase-4-Kill-Switch.md`](../PLAN-Phase-4-Kill-Switch.md))

## Context

The v2 plan is complete through Phase 3D + post-mortem, and the stack's own
governance mapping names the remaining runtime gap: OWASP **ASI08** and **ASI10**
are 🟡 Partial with *"no circuit-breakers"* and *"no runtime kill-switch"* as the
stated residual gaps. Guardrail coverage is the scorecard's weakest dimension.

Phase 4 is **net-new scope beyond the PRD's plan**, which per repo convention
requires an ADR. The design questions:

1. **What is the revocable thing?** An agent is a loop with credentials; killing
   the loop leaves its authority alive. Industry practice revokes cloud
   credentials (STS session revocation, vault lease revocation, identity-provider
   token introspection) — all cloud- or infrastructure-specific, all in tension
   with the PRD's vendor-neutrality and the 3D air-gap requirement.
2. **Where does identity live?** The gateway today has **no authentication** —
   any caller on the port is anonymous, so "revoke agent X" is not expressible.
3. **How do we stop the loop itself**, promptly and cleanly, given
   `ModelProvider.generate` has no cancellation surface (no `AbortSignal`, no
   deadline) anywhere in the stack?
4. **What pulls the trigger?** A kill switch nobody (and nothing) triggers is
   decoration.

## Decision

**1. The gateway session is the credential — revocation is a state flip, not a
cloud API call.** Phase 2C already made the gateway the sole model path and the
agent credential-free by construction (ADR 0007). Therefore a per-agent,
per-session record in the gateway — issued against a per-agent key (hashed at
rest), sliding TTL, `active | throttled | denied | killed` state — is a
*complete* revocation mechanism: flip the state and the agent is inert on its
very next call, regardless of any downstream credential format or TTL. **No
cloud-specific implementation is built** — no STS/IAM roles, no vault, no
external IdP, no token exchange. Those are documented as deployment guidance for
adopters whose agents hold multi-service authority; in this stack they would add
cloud dependencies (breaking `sovereign verify`) to solve a problem the broker
architecture already removed.

**2. The state check is per-call and never cached.** The check runs inside
`GatewayService.generate()` before policy evaluation, on every request. A cached
"allow" decision is the canonical way revoked sessions keep working against
one's own gateway; we exclude it by construction. Denial is a structured
violation raised agent-side as `SessionRevokedError` (sibling of
`GuardrailError`), terminal and non-retryable in the PEV loop.

**3. Identity is default-on; the session store is in-memory behind an
interface.** Gateway auth ships default-on with `RELIABILITY_GATEWAY_AUTH=off`
as the local-dev escape (mirroring `RELIABILITY_GATEWAY=off`), refused in
sandboxed processes. The reference gateway is a single process, so the
`SessionStore` is an in-memory `Map` behind an interface — a persistent store
(e.g. Redis) is an adopter swap, not a redesign. Keys are runtime artifacts,
never committed; the existing secret-scan layers gain a pattern for the key
format. The wire contract changes (`agentId`/`sessionId` on
`GatewayGenerateBody`) live in `@grade-stack/core`, which owns the seam
(consistent with ADRs 0005/0006/0007).

**4. Cancellation is added at the seam, optionally.**
`ModelProvider.generate(request, opts?: { signal?: AbortSignal })` plus
`deadlineMs`/`signal` on `runPEV` and a wall-clock timeout per provider call —
an optional second parameter, so every existing implementation and call site
stays valid and the CI eval gate's committed baseline is untouched. Process
termination alone is a pause button with leaks; paired with session revocation
it makes the stop clean.

**5. Tripwires are deterministic and graduated, and only ever tighten.**
Per-session counters (tokens, call rate, consecutive identical args-hashes)
against `GatewayPolicy` thresholds, off by default. Escalation is automatic
(rate → `throttled`; budget or loop → `denied`), audit-logged with the tripwire
named; de-escalation is admin-only. Budgets are **token-denominated** so the
gateway stays deterministic and provider-neutral; a USD view derives optionally
from the existing pricing config. This continues the 2C choice of cheap,
reproducible, air-gap-safe mechanisms over model-based detection.

**6. The audit trail is an append-only JSONL of hashes, and the fire drill is a
mechanism.** Every call appends timestamp, agent, session, args-hash (never raw
content — the audit file must not become a secret/PII store), tokens, outcome.
`gateway demo --kill-drill` runs the agent, kills its session mid-task via the
admin endpoint, and prints pass/fail proofs in the established four-proof style;
it is asserted in `gateway.test.ts` and included in `sovereign verify
--gateway`, so "the switch has been fired" is test-enforced, not asserted.

## Rationale

- **Structural, not procedural.** Because 2C isolation is enforced by
  construction, gateway-side denial *is* total de-authorization — the design
  reuses the strongest property the stack already has instead of importing a
  credential-lifecycle stack to manage credentials the agent doesn't hold.
- **Vendor-neutral and air-gap-safe.** Every mechanism runs in-process on Bun,
  deterministic under the stub provider, and demonstrable with networking
  disabled — Phase 4 strengthens the sovereign story rather than trading it away.
- **Graduated beats binary.** Most incidents want "throttle / deny while we
  look," not "everything off." The state enum encodes that; `read-only` as a
  distinct state is deliberately deferred until a side-effecting tool exists to
  make it meaningful.
- **Honest scope.** Saga/compensation, idempotency keys, sub-agent lineage
  kill, scope-drift/canary detection are named as enhancements, not built: each
  protects a capability (writes, sub-agents, resource surface) the reference
  stack does not have. The session record carries `parentSessionId` so lineage
  is expressible later.

## Consequences

- The gateway becomes stateful (sessions, counters) — still a single process,
  but restart now drops live sessions; acceptable for a reference
  implementation and called out in docs, with the `SessionStore` interface as
  the extension point.
- `gateway serve` gains an admin surface (loopback-bound, startup-minted admin
  token) — a second secret-like runtime artifact that must never land in the
  repo; covered by the same scan layers as agent keys.
- Existing single-call flows gain a handshake/auth step; `RELIABILITY_GATEWAY_AUTH=off`
  preserves the old behavior for local dev only.
- The OWASP ASI08/ASI10 rows and the Guardrail-coverage dimension are re-scored
  **at build time against what actually shipped** — this ADR does not pre-commit
  a scorecard outcome.
