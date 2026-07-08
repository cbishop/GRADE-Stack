# ADR 0015 — Confidence router: self-consistency escalation in the gateway

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase:** 2C (LLM gateway) — reliability/cost routing extension

## Context

The gateway (ADR 0007) forwards each request to **one** provider. That leaves the
core cost/reliability question of a mid-market deployment unanswered: *when does a
cheap local model actually replace the frontier API?* The sibling `lora` project
answered it empirically for the triage task — a fine-tuned local 3B trails the
Bedrock Haiku baseline on enum exact-match (0.44 vs 0.60), concentrated in two
minority `category` classes — and prototyped the canonical fix in
`triage/router.py`: keep the cheap local model on the confident bulk and
**escalate only the low-confidence tail** to the frontier tier. On the client's
own held-out test set that router **matched Haiku's enum-EM and beat its
category-F1 while escalating ~15% of traffic — an 85% cost reduction.**

This ADR records folding that policy into grade-stack so "escalate low-confidence
to Bedrock" is a **running config**, not a research script. Three questions had to
be resolved:

1. **Where does routing live?** It is orchestration *around* provider calls, and
   the gateway is already exactly that layer — the one place that wraps every
   model call in policy.
2. **What is the confidence signal, given the `ModelProvider` seam is
   text-in/text-out with no log-probs (ADRs 0005/0006)?**
3. **How does a task-specific agreement signal live in a deliberately
   task-agnostic gateway** without importing the reference agent's schema?

## Decision

**The confidence router is an optional orchestration layer inside
`@grade-stack/gateway`** (`gateway/router.ts`), not a new provider and not a new
process. `GatewayService` gains an optional `router`; when present it runs the
router in place of the single-provider forward, and **the existing input/output
guardrails still wrap whatever the router returns** — an escalated frontier
result is redacted/secret-checked identically. Absent a router, the gateway is
byte-for-byte the ADR 0007 forwarder, so the default path and the CI eval gate
are untouched.

**The confidence signal is self-consistency, not log-probs.** The router samples
the local provider **N times at a non-zero temperature** and measures how often
the samples agree on a *consensus key*. High agreement ⇒ the model is sure ⇒ keep
the local answer for \$0; agreement below a threshold ⇒ escalate the original
request to the frontier provider. The modal vote doubles as a better local
prediction than greedy decoding. This needs nothing from the provider beyond the
existing text seam, so it works over Bedrock, Ollama, and the 3D air-gapped
variant unchanged.

**The consensus key is a configurable list of JSON fields**, which is what keeps
the gateway task-agnostic. For triage the fields are the three closed enums
`["category", "priority", "sentiment"]`, so two outputs "agree" iff those three
match — free-text `summary`/`draft_reply` variation is ignored, exactly as the
Python prototype's enum-triple did. An empty field list falls back to whole-text
agreement. The gateway therefore carries **no** triage schema import; the field
list is plain configuration.

**Routing is a server-side running config.** The gateway process opts in with
`RELIABILITY_ROUTER=1` and tunes the operating point with `RELIABILITY_ROUTER_*`
(local/escalate tiers, N, temperature, threshold, consensus fields); the defaults
encode Week 3's best point (N=5, temperature 0.7, escalate below 0.5 agreement,
enum consensus). The signal cannot cross the per-request HTTP boundary, so — like
the guardrail policy — it is configured when the credentialed gateway is
constructed. Both provider tiers are checked against the model allowlist up front,
so an escalation to a non-allowlisted frontier model fails predictably rather than
mid-request. The response carries an optional `routing` block (escalated?,
agreement confidence, valid samples, serving provider) so the scorecard can read
the escalation rate; it echoes the decision, never extra model output.

## Rationale

- **The gateway is the right home.** Routing is policy around model calls, which
  is the gateway's whole job; putting it here means guardrails compose over the
  escalated result for free, and the agent seam (`GatewayProvider`) is unchanged.
- **A router is not a `ModelProvider`.** Its served `provider`/`model` vary per
  request (local vs frontier), so modelling it as one of the fixed `ProviderName`
  values would be a lie the cost accounting has to unwind. Orchestration, not a
  provider, keeps `GenerateResult.provider` honest.
- **Config over schema keeps the seam narrow.** Expressing the agreement signal as
  JSON field names — not an injected function or a schema import — means the
  signal is serializable, env-tunable, and reusable for any structured task,
  while the gateway stays free of task-specific code (consistent with 0005/0006).
- **Self-consistency is the cheapest lever.** It recovers most of the local-vs-
  frontier quality gap before a single escalation, needs no retraining and no
  log-probs, and the whole reliability-vs-cost curve is one tunable threshold.

## Consequences

- Turning routing on multiplies **local** inference by N per request (the votes
  run concurrently); escalations add one frontier call. The operating point is a
  business decision — ~15% escalation bought frontier-parity at −85% cost in the
  Week 3 sweep — surfaced in the gateway startup log and the `routing` metadata.
- The **exact escalation rate at a fixed threshold is noisy** across small
  calibration splits, while the *quality ordering* transfers (the Week 3 caveat).
  The robust deliverable is the curve; pick a conservative threshold and read the
  live escalation rate from the `routing` block rather than trusting one number.
- The consensus signal only fires for structured outputs; for free-text tasks the
  fallback is whole-text agreement, which rarely agrees and thus mostly escalates.
  Routing is opt-in per deployment precisely because it fits classification/
  extraction, not open-ended generation.
- Making a fine-tuned local model the gateway **default** tier remains a separate
  scope change; this ADR wires the *mechanism* and leaves the *default* to a
  future pilot-driven decision.
