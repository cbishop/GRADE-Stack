# ADR 0013 — OWASP guardrail scoring v2: an applicability axis and a "no true gaps" floor

- **Status:** Accepted
- **Date:** 2026-06-25
- **Phase:** Post-mortem remediation (revises Phase 3A / [ADR 0009](0009-owasp-agentic-top10-mapping-and-guardrail-coverage.md))

## Context

The post-mortem review (`docs/post-mortem.md`) found the Guardrail-coverage
dimension dishonest in the way that matters most to an executive. Two of the ten
OWASP agentic threats — **ASI06 Memory & Context Poisoning** and **ASI07 Insecure
Inter-Agent Communication** — target capabilities a single-agent, stateless
reference architecture does not have (a long-term memory store; an agent-to-agent
channel). ADR 0009 scored them as `gap` (weight 0) inside a fixed 10-item
denominator, which:

1. presented an **architectural boundary as a deficiency** — the readout said
   "explicit gaps to close," but there is nothing to fix: the capability the
   threat attacks does not exist in the code; and
2. forced the score to `(2·1 + 6·0.5 + 0)/10 = 0.50 → At risk`, and via the
   worst-wins rollup, dragged the **whole scorecard** to At risk.

The damning detail: the project had **already solved this** two phases later. The
EU AI Act module (3C, [ADR 0011](0011-eu-ai-act-deployer-readout-and-governance-readiness.md))
scores readiness over a `scoredCount` of stack-supportable obligations and lists
the rest as `deployer-owned` and **unscored**; the NIST module (3B,
[ADR 0010](0010-nist-ai-rmf-mapping-shared-responsibility.md)) states the
principle outright: *"a control the stack cannot provide is a responsibility
boundary, NOT a deficiency."* OWASP — the first governance module — never got the
upgrade.

## Decision

### 1. An applicability axis: `scored`, with the score over applicable threats only

Each OWASP item now carries a `scored: boolean` (the model already used by the EU
AI Act module). A threat is `scored: false` **only** when it is out of
architectural scope — the capability it targets is not implemented in this
single-agent, stateless stack. The weighted coverage score is taken over the
**scored (applicable)** threats; out-of-scope threats are reported (with their ids
and reasons) but never enter the denominator and are never counted as gaps.

`computeGuardrailCoverage` now exposes `scoredCount`, `outOfScope`, and
`outOfScopeIds` alongside the existing counts. The committed mapping is now
**2 covered · 6 partial · 0 gaps over 8 applicable; 2 out of scope** →
`5/8 = 0.625`.

**"Out of scope" is not a free pass.** A `scored: false` item must state, in its
`residualGap`, why the capability is architecturally absent (enforced by a Zod
`.refine`). The CI check prints the applicable/out-of-scope split so any
reclassification is visible in review. This is the same honesty guard the EU AI
Act module relies on: the mechanism makes silent omission impossible; the
*justification* for a boundary remains a reviewed, on-the-record claim.

### 2. A "no true gaps" floor: at least Adequate when nothing applicable is unaddressed

`0.625` still lands in the At-risk band (`≥0.5`), and the applicability fix alone
would leave the dimension At risk. That under-sells a stack where **every
applicable threat has a named, shipped mechanism and zero are unaddressed** — the
score is dragged only by *shallow* (partial) coverage, not by holes.

So the guardrail rating now has a floor: **if no applicable threat is an
unaddressed gap (`gaps === 0`), the rating is at least Adequate.** Partial
coverage is not the same as a hole. The floor keys off *zero gaps*, not the
average, so it cannot launder a real deficiency — a single genuine gap removes the
floor and the band applies normally. With the floor, the committed mapping reads
**Adequate**, and the overall verdict lifts from At risk to Adequate for a
principled reason (nothing applicable is unaddressed), not by deleting
inconvenient rows.

### 3. Evidence stays a glass box, and now names the boundary

The evidence lines now report "*N of 10 threats apply … of those, X covered, Y
partial, Z unaddressed*", state the band thresholds inline (so a reader sees why a
score sits where it does), name the partials, and — critically — name the
out-of-scope threats as **"Out of architectural scope — not deficiencies,"**
explaining they become relevant only if a deployment adds the capability (memory/
RAG, multi-agent messaging). An executive can now tell at a glance what is
actionable (the partials) from what is a forward-looking condition (the
boundaries).

## Consequences

- The reference stack's honest guardrail self-assessment is now **Adequate**, and
  the overall scorecard is **Adequate** (was At risk). This is *more* honest, not
  less: it stops asserting an unfixable to-do and reports the real, closeable work
  (six partials, each with a named residual gap) plainly.
- ADR 0009's scoring section (fixed 10-item denominator; ASI06/ASI07 as gaps) is
  **superseded by this ADR**; its taxonomy pin, mapping format, and "no silent
  omissions" mechanism stand.
- A standing duty: a threat may move from `scored: false` to `scored: true` the
  moment a deployment adds the capability it guards (persistent memory, multi-
  agent topology). The mapping's `scopingNote` and each item's `residualGap` say
  so; the boundary is documented, not assumed permanent.
- The committed sample scorecard is regenerated per cycle (now `content/cycle-12/`)
  rather than rewritten in place — older cycle samples remain point-in-time
  snapshots.

## Alternatives considered

- **A fourth status value `not-applicable` (single enum).** Rejected for cross-
  module consistency: NIST/3B and EU/3C already separate *whether an item is
  scored* from *its support status*. Reusing `scored: boolean` unifies all three
  governance modules on one model (see [ADR 0014](0014-bundled-governance-data-and-unified-mapping-validation.md)).
- **Exclude the two items entirely (drop from the mapping).** Rejected — it
  violates "no silent omissions"; a reader must still see ASI06/ASI07 and *why*
  they are out of scope, so a memory-equipped or multi-agent deployment knows to
  close them.
- **Applicability fix without the floor (leave it At risk at 0.625).** Rejected —
  honest about the boundary but still mislabels "every applicable threat has a
  mechanism, none unaddressed" as At risk. The floor is bounded (keys off zero
  gaps) so it improves accuracy without becoming a rating launderer.
- **Lower the Adequate band threshold instead of a floor.** Rejected — it would
  silently re-rate every dimension that shares the band, including ones where a
  mid score genuinely *should* read At risk. A targeted floor is narrower and
  states its own justification.
