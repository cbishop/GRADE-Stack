# PLAN — Phase 4: Agent Kill Switch & Runtime Revocation

**Status:** Planned (design accepted — [ADR 0015](decisions/0015-agent-identity-session-revocation-and-kill-switch.md)); no sub-phase started.
**Scope class:** Net-new scope beyond the v2 plan (which is complete through Phase 3D + post-mortem). This document is the plan of record for Phase 4; [`PLAN-Grade-Stack-v2.md`](PLAN-Grade-Stack-v2.md) links here and remains the ledger for Phases 0–3.

---

## Why this phase exists

The stack's own governance mapping names the gap: `governance/owasp/README.md` marks **ASI08 (Cascading Failures)** and **ASI10 (Rogue Agents)** as 🟡 Partial, citing *"no circuit-breakers"* and *"no runtime anomaly detector or kill-switch."* Guardrail coverage is the scorecard's weakest dimension. Phase 4 closes the runtime half of that gap.

The core insight driving the design: **an agent is not a process you can SIGKILL — it is a loop with credentials.** Killing the loop leaves its authority alive; revoking its authority makes the loop inert everywhere at once. Phase 2C already built the decisive precondition: the agent holds **no** provider credentials and can only reach a model through the gateway (`RELIABILITY_AGENT_SANDBOX=1`, `isolatedAgentEnv`, factory guards — ADR 0007). That converts "revoke this agent's credentials across every downstream system" into a single state flip in a session store **we own**. Phase 4 builds that session store, the flip, the automatic tripwires that pull it, and the proof that it works.

### The acceptance frame: six questions per agent

Phase 4 is done when the reference stack can answer these with a mechanism, not prose:

| # | Question | Pass criteria |
|---|---|---|
| 1 | Does the agent have its own identity? | Distinct principal per agent, per session; no anonymous callers |
| 2 | Is its authority short-lived and revocable? | Sliding-TTL session; documented, tested revocation path |
| 3 | Is there a chokepoint with per-agent policy? | All model calls through the gateway, policy keyed by session |
| 4 | Are there automatic tripwires with graduated responses? | Budget/rate/loop triggers wired to throttle → deny |
| 5 | Is there an audit trail sufficient to reconstruct a run? | Durable per-call log with agent/session identity |
| 6 | Has the switch actually been fired? | A scripted fire drill, asserted in tests and runnable live |

Row 6 is the tell: a kill switch that has never been fire-drilled is a hypothesis, not a control.

---

## Scope boundary — build now vs. potential enhancements

**Hard constraint carried from the PRD and Phase 3D:** nothing in Phase 4 may introduce a cloud dependency. Everything below runs air-gapped, deterministically, on the existing Bun/TS stack, and `sovereign verify` must stay green. **No cloud-specific implementation is planned** — no STS/IAM roles, no vault, no external identity provider.

### Build now (Phase 4, this plan)

| Capability | Mechanism |
|---|---|
| Per-agent, per-session identity | Gateway-issued session bound to a per-agent key (hashed at rest); identity on every request and every trace span |
| Instant revocation | Session state flip, checked **per call, never cached**; typed denial the agent cannot suppress |
| Graduated responses | Session states `active → throttled → denied → killed`, flippable by admin action or tripwire |
| Cooperative halt | `AbortSignal` + deadline through the `ModelProvider` seam and the PEV loop |
| Automatic tripwires | Per-session token budget, call-rate ceiling, repeat-call loop detection → automatic state transitions |
| Audit trail | Append-only JSONL at the gateway: timestamp, agent, session, args-hash, outcome |
| Fire drill | A scripted run-then-kill-mid-task proof, test-asserted and runnable live via the CLI |

### Potential enhancements (documented, deliberately not built)

These are deployment guidance for adopters, not reference-stack scope. Each is out because it violates a project constraint (cloud dependency, non-determinism) or because the stack lacks the capability it protects:

- **Cloud identity machinery** — per-agent IAM roles/STS session policies, managed identities, dynamic-secret vaults, OAuth token exchange, SPIFFE/SPIRE. The broker pattern makes these unnecessary here: the gateway session *is* the revocable credential. Adopters running multi-service agents should map the session concepts onto their platform's short-lived-credential primitives.
- **External session store** (Redis etc.). The reference gateway is a single process; the store is in-memory behind an interface. The interface is the contract — a persistent store is a swap, not a redesign.
- **Saga/compensation logic and idempotency keys.** The MCP tools are read-only canned data; there are no side-effecting tool calls to unwind yet. The audit trail (built now) is the prerequisite; compensation becomes real scope only when a write-capable tool does.
- **`read-only` as a distinct graduated state.** Same reason — with no write tools, read-only ≡ active. The state enum leaves room for it.
- **Sub-agent lineage kill** (parent session revocation cascading to derived child sessions). The reference agent spawns no sub-agents. The session record carries an optional `parentSessionId` so lineage is expressible when it matters.
- **Scope-drift detection, canary resources, model-based anomaly detection.** Valuable tripwires, but non-deterministic or dependent on a resource surface the stack doesn't have. The built tripwires (budget, rate, loop) are the quantitative, reproducible core.
- **Alerting/paging integration.** The tripwire→state transition is the mechanism; notification transport is deployment-specific.

---

## Sub-phases

One sub-phase per branch, per repo convention. Estimated cadence matches the v2 plan (~2 weeks each). Content cycles continue the build-in-public series (`content/cycle-13/` onward).

### Phase 4A — Agent identity & session registry

**Branch:** `phase-4a-agent-identity`

1. **Gateway authentication.** Per-agent keys: minted by the gateway (`reliability gateway mint-key --agent <id>` or at `gateway serve` startup for the demo agent), stored **hashed** (SHA-256) in the gateway process; the plaintext key exists only in the spawned agent's environment. Keys are runtime artifacts — nothing key-like is ever committed (the existing secret-scan layers enforce this). Auth is **default-on**; `RELIABILITY_GATEWAY_AUTH=off` is the local-dev escape, mirroring the `RELIABILITY_GATEWAY=off` convention, and is refused when the caller is sandboxed.
2. **Session registry.** On first authenticated call (or an explicit handshake), the gateway issues a session: `{ sessionId, agentId, state, createdAt, lastSeenAt, ttl, parentSessionId?, counters }`. Sliding TTL (default 15 min); expiry ≡ revocation. In-memory `Map` behind a `SessionStore` interface (see enhancements). Unauthenticated or expired-session calls get a typed 401 body, raised agent-side as a distinct error.
3. **Identity through the seam.** `GatewayGenerateBody` (in `@grade-stack/core`, which owns the wire contract) gains `agentId`/`sessionId`; `isolatedAgentEnv()` in `packages/gateway/src/sandbox.ts` injects the key + agent id at spawn; every gateway trace span and every violation record carries both ids.
4. **Audit trail.** Append-only JSONL (`RELIABILITY_GATEWAY_AUDIT_LOG` path, default alongside the gateway process): timestamp, agentId, sessionId, request **args-hash** (never raw content — no secrets or PII in the audit file), model, token counts, outcome (`ok | guardrail | denied | error`). This is the reconstruction record rows 5 of the rubric demands.

**Acceptance:**
- [ ] An unauthenticated `POST /v1/generate` is refused with a typed error; the same request with a minted key succeeds and returns a session id. Test-asserted over the wire.
- [ ] A planted key never reaches the repo: gitleaks + pre-commit patterns extended for the new key format; asserted by attempting to commit a fixture key.
- [ ] Every gateway call appends one audit line with agent/session identity and an args-hash; a full `gateway demo` run is reconstructable from the audit file alone (test walks the file and matches the call sequence).
- [ ] Session TTL works: a session idle past its TTL is refused on its next call (test with a short TTL).
- [ ] **Artifact:** post — *"Your agent doesn't need credentials. It needs an identity."* (`content/cycle-13/`).

### Phase 4B — The kill lever & graduated states

**Branch:** `phase-4b-kill-lever`

1. **Session states.** `active | throttled | denied | killed`. `throttled` = rate-limited (429-style backoff instruction); `denied` = every model call refused but the session record lives (reversible — "read-only while we look at this," minus the read-only semantics deferred above); `killed` = terminal, non-reversible, session cannot be re-authenticated with the same key until re-minted.
2. **Admin surface.** `GET /admin/sessions` (list, with states + counters) and `POST /admin/sessions/{id}/state` on the gateway, bound to loopback and guarded by an admin token minted at `gateway serve` startup (printed to the operator's console, never to the agent env). CLI: `reliability agent sessions` and `reliability agent kill <sessionId|agentId>` (kills all sessions for an agent id).
3. **Per-call enforcement, never cached.** The state check runs inside `GatewayService.generate()` **before** policy evaluation, on every call. No TTL-style caching of the decision — a cached "allow" is the classic bug that keeps a revoked session working. Denials return a structured violation the agent surfaces as a typed `SessionRevokedError` (sibling of `GuardrailError`) that the PEV loop treats as terminal, not retryable.
4. **The fire drill — the phase's headline proof.** `reliability gateway demo --kill-drill`: spawns the credential-isolated agent on a multi-turn task, flips its session to `killed` mid-run via the admin endpoint, and prints pass/fail proofs in the existing four-proof style: (a) calls before the kill succeeded, (b) the first call after the kill was refused at the gateway, (c) the agent loop halted with `SessionRevokedError` rather than retrying, (d) the audit log shows the exact cut point. Asserted in `gateway.test.ts` alongside the isolation probe.

**Acceptance:**
- [ ] Kill is effective on the very next call after the state flip, with zero grace window, proven over the wire (test) and live (`--kill-drill`).
- [ ] A killed session stays dead: retries, new connections with the same session id, and re-auth with the same key all fail until the key is re-minted.
- [ ] The fire drill runs air-gapped: `sovereign verify --gateway` extended to include the kill-drill proof, so revocation is demonstrated with zero cloud dependency.
- [ ] Enforcement register gains its row (see below); `governance/owasp/` ASI10 re-scored honestly against the shipped mechanism.
- [ ] **Artifact:** post — *"We killed our agent mid-task on purpose. Here's the recording."* (`content/cycle-14/`).

### Phase 4C — Cooperative halt through the seam

**Branch:** `phase-4c-abort-seam`

Revocation stops the *authority*; this sub-phase stops the *loop* promptly and bounds every call in time. (Layer-1 process termination alone is a pause button with leaks — but paired with revocation it makes the stop clean.)

1. **Abort through the provider seam.** `ModelProvider.generate(request, opts?: { signal?: AbortSignal })` — an optional second parameter, so every existing call site and implementation stays valid. Bedrock's SDK (`abortSignal`) and `fetch` (ollama/gateway providers) both accept signals natively; the stub resolves synchronously and simply checks the signal.
2. **Deadline + abort in the PEV loop.** `runPEV` gains `opts.signal` and `opts.deadlineMs`; the loop checks at the top of each turn and threads the signal into every model call. `MaxTurnsError` gets siblings: `AbortedError`, `DeadlineExceededError`. The reference agent exposes `--deadline` / `RELIABILITY_DEADLINE_MS`.
3. **Per-call wall-clock timeout.** Every provider call is bounded (`RELIABILITY_CALL_TIMEOUT_MS`, generous default) — currently a hung model call hangs the run forever. Implemented once at the seam (the `traceProvider` wrapper is the natural spot), not per provider.
4. **Halt on revocation.** `SessionRevokedError` (4B) aborts the run's controller, so in-flight parallel work (MCP grounding) stops with the loop rather than orphaning.

**Acceptance:**
- [ ] Aborting mid-run halts before the next model call; a deadline expiring mid-run raises `DeadlineExceededError`; both test-asserted with the stub provider (deterministic, no wall-clock flake in CI — fake timers or injected clock).
- [ ] A hung provider call is cut by the call timeout (test with a never-resolving fake).
- [ ] No behavior change when no signal/deadline is passed: CI eval gate still passes untouched against the committed baseline.
- [ ] **Artifact:** post — *"AbortSignal is the most underrated AI-safety API"* (`content/cycle-15/`).

### Phase 4D — Tripwires & graduated auto-response

**Branch:** `phase-4d-tripwires`

A kill switch nobody triggers is decoration; humans are too slow to be the first responder for a runaway loop. The tripwires are deliberately boring and quantitative — deterministic, unit-testable, air-gap-safe, in the spirit of the 2C regex/Luhn guardrails.

1. **Per-session counters** (in the session record, updated per call): cumulative tokens in/out, call count, calls-per-minute window, consecutive-identical-request count (args-hash from 4A ≡ loop detection).
2. **Thresholds in `GatewayPolicy`**, with off-by-default = current behavior: `sessionTokenBudget`, `maxCallsPerMinute`, `maxIdenticalCalls`. Budgets are **token-denominated** (deterministic, provider-neutral); a USD view derives optionally from the existing pricing config rather than making the gateway depend on live price tables.
3. **Graduated auto-transitions**, escalating: rate ceiling → `throttled`; token budget or loop detection → `denied`; each transition writes an audit line naming the tripwire and threshold. De-escalation (`denied → active`) is admin-only — tripwires only ever tighten.
4. **Governance + scorecard close-out.** Re-score `governance/owasp/` ASI08/ASI10 against the shipped mechanisms (honestly — re-classified at build time, not promised here); regenerate the sample scorecard; update `docs/production-readiness-assessment.md` with the runtime-control section and the fire-drill step.

**Acceptance:**
- [ ] A stub-driven runaway loop (identical request repeated) is auto-denied at the configured threshold with no human action; test-asserted, and demonstrable live via a demo flag.
- [ ] A session crossing its token budget is denied on the next call; the audit line names the tripwire.
- [ ] Thresholds off ⇒ byte-identical gateway behavior; CI eval gate and committed baseline untouched.
- [ ] Guardrail-coverage dimension recomputed from the updated OWASP mapping; the scorecard movement (if any) is evidence-backed, never hand-adjusted.
- [ ] **Artifact:** post — *"Throttle, deny, kill: graduated responses beat the big red button"* (`content/cycle-16/`) + regenerated sample scorecard.

---

## Enforcement-register additions (target rows)

To be appended to the register in `PLAN-Grade-Stack-v2.md` as each sub-phase lands:

| Rule | Mechanism | Introduced |
|---|---|---|
| No anonymous model calls | Gateway auth default-on; unauthenticated `generate` refused with a typed error | Phase 4A |
| Every agent action attributable | Session identity on every request, span, and audit line; append-only JSONL audit | Phase 4A |
| A revoked agent cannot act | Per-call session-state check (never cached) → `SessionRevokedError`; proven by the kill-drill in tests + `gateway demo --kill-drill` | Phase 4B |
| Kill switch is fire-drilled, not hypothetical | Kill-drill asserted in `gateway.test.ts` and included in `sovereign verify --gateway` | Phase 4B |
| No unbounded model call or agent run | Per-call wall-clock timeout + PEV deadline/abort at the seam | Phase 4C |
| Runaway loops auto-contained without a human | Budget/rate/loop tripwires → automatic `throttled`/`denied` transitions, audit-logged | Phase 4D |

## Verification (how to confirm the phase is real, not asserted)

From a clean clone at each sub-phase boundary, in addition to the standing local gate (`bun run typecheck && bun run check && bun run test && bun run build`):

- **4A:** start `gateway serve`; a curl without a key is refused; `gateway demo` runs authenticated end-to-end; the audit file reconstructs the run; a planted fixture key is blocked at commit and caught by CI gitleaks on a branch.
- **4B:** run `gateway demo --kill-drill` → all proofs pass; run it again under `sovereign verify --gateway` with networking disabled → still passes; `reliability agent kill` from a second terminal stops a live `agent run` mid-task.
- **4C:** `agent run --deadline 1` fails fast with `DeadlineExceededError`; CI eval gate unchanged vs. baseline.
- **4D:** demo a stub-driven loop → auto-denied at threshold; scorecard regenerated and the Guardrail-coverage evidence cites the new mechanisms.

**Phase 4 gate:** the six-question rubric at the top of this document answers every row with a named, test-asserted mechanism — including row 6, live and air-gapped.
