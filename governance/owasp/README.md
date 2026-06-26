# OWASP Agentic Top 10 → GRADE-Stack mapping

This directory maps every item of the **OWASP Top 10 for Agentic Applications**
to a concrete mechanism in this stack — or explicitly flags it as a gap, or marks
it out of architectural scope. There are **no silent omissions**: each of the ten
threats is either *covered* (a named, shipped mechanism), *partial* (a named
mechanism with a stated residual gap), or *gap* (no mechanism — flagged, never
assumed safe).

Each threat also carries a **`scored`** flag. A threat is `scored: false` only
when it is **out of architectural scope** — it targets a capability this
single-agent, stateless reference does not implement (a long-term memory store; an
agent-to-agent channel). Such a threat is reported, with its reason stated, but is
**excluded from the weighted score's denominator**: it is a scope boundary, **not
a deficiency to fix**. The boundary becomes a real, scored obligation the moment a
deployment adds that capability. (Scoring model: [ADR 0013](../../docs/decisions/0013-owasp-guardrail-scoring-v2-applicability-and-no-true-gaps-floor.md).)

The mapping has two forms that are kept in lock-step by a CI check
(`scripts/check-owasp-coverage.ts`, wired into `bun run check`):

- **Machine-readable:** [`owasp-agentic-top10-2026.json`](./owasp-agentic-top10-2026.json) —
  the source of truth the scorecard's **Guardrail coverage** dimension is computed from.
- **Human-readable:** this file.

## Taxonomy cited (verified at build time)

| Field | Value |
|---|---|
| Taxonomy | **OWASP Top 10 for Agentic Applications** |
| Edition / version | **2026** |
| Identifier scheme | **ASI01:2026 – ASI10:2026** |
| Published | **2025-12-09** |
| Re-verified for this mapping | **2026-06-23** |
| Source | <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/> |

> **Why the identifier scheme matters.** Earlier OWASP agentic-threat work used a
> `T1`–`T15` numbering; the published **2026** Top 10 uses **`ASI01:2026`–`ASI10:2026`**.
> This mapping is pinned to the `ASI` scheme above and was re-verified against the
> live OWASP GenAI Security Project listing on the re-verification date — per the
> plan's build-time re-verification requirement.

## Scope of this mapping

The mechanisms below assess **the GRADE-Stack reference agent**: a single-agent
**planner → executor → validator** that triages an inbound support email and
drafts a structured reply, fronted by the **LLM gateway**, over a **text-only
provider seam**. Where a threat only arises in architectures this stack does not
implement (persistent memory, multi-agent messaging), it is marked **out of scope
(`scored: false`)** — reported, with its reason stated, but not counted as a gap to
fix — because there is no code surface to harden until such a deployment exists.

## Coverage at a glance

Weights for the rolled-up score: `covered = 1.0`, `partial = 0.5`, `gap = 0.0`,
taken over the **applicable** (`scored: true`) threats only. Out-of-scope threats
are reported separately and do not enter the denominator.

| ID | Threat | Status | Primary mechanism (or boundary) |
|---|---|---|---|
| ASI01:2026 | Agent Goal Hijack | 🟡 Partial | Gateway server-side prompt-injection / override denial (sole model path) |
| ASI02:2026 | Tool Misuse & Exploitation | 🟡 Partial | Name-blind tool selection + tool/resource control model + turn bound |
| ASI03:2026 | Agent Identity & Privilege Abuse | 🟢 Covered | Structural credential isolation — agent holds no provider credentials |
| ASI04:2026 | Agentic Supply Chain Compromise | 🟡 Partial | Secret scan + pinned lockfile + name-blind selection (no SCA / tool signing) |
| ASI05:2026 | Unexpected Code Execution | 🟢 Covered | No code-execution surface; validator is Zod schema-parse, not execution |
| ASI06:2026 | Memory & Context Poisoning | ⚪ Out of scope | Stateless agent — no memory subsystem to poison; relevant only if a deployment adds persistent memory/RAG |
| ASI07:2026 | Insecure Inter-Agent Communication | ⚪ Out of scope | Single-agent — no A2A channel to secure; relevant only in a multi-agent deployment |
| ASI08:2026 | Cascading Agent Failures | 🟡 Partial | Enforced turn bound + token caps + eval-gate/degraded canary (no circuit-breakers) |
| ASI09:2026 | Human-Agent Trust Exploitation | 🟡 Partial | Evidence-backed scorecard + validator/judge (no in-output uncertainty disclosure) |
| ASI10:2026 | Rogue Agents | 🟡 Partial | Turn bound + sole-path gateway + baseline/canary + traces (no runtime kill-switch) |

**2 covered · 6 partial · 0 gaps over 8 applicable threats; 2 out of scope**
(ASI06, ASI07). Every applicable threat has a named mechanism — there are **no
unaddressed applicable gaps**. The two out-of-scope threats describe attack
surfaces a single-agent, stateless reference architecture does not implement; they
are reported (never waved away) so that any memory-equipped or multi-agent
deployment knows it must add the corresponding mechanism — but they are scope
boundaries, **not deficiencies in this stack**.

## Per-threat detail

The authoritative per-threat detail — every named mechanism, its source
reference, and the stated residual gap — lives in
[`owasp-agentic-top10-2026.json`](./owasp-agentic-top10-2026.json) so the scorecard
and this document cannot drift. Read it alongside the table above; each item
carries its `mechanisms[]` (with `ref` pointing at the file/ADR that implements it)
and a `residualGap` sentence.

## How this feeds the scorecard

The scorecard's **Guardrail coverage** dimension (un-stubbed in Phase 3A; scoring
revised per [ADR 0013](../../docs/decisions/0013-owasp-guardrail-scoring-v2-applicability-and-no-true-gaps-floor.md))
is computed directly from the JSON: the weighted coverage score over the
**applicable** threats sets the band, a **"no true gaps" floor** keeps the rating
at least *Adequate* when every applicable threat has a mechanism (zero
unaddressed), and the evidence lines name the counts, the partials, **and the
out-of-scope threats as boundaries rather than gaps to close**. The citation above
is carried onto the readout. No guardrail rating is asserted without this mapping
behind it — the same "no unsupported scores" contract every other dimension obeys.
