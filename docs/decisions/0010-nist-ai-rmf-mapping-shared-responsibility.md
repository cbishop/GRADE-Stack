# ADR 0010 — NIST AI RMF mapping: version pin, shared-responsibility status model, standalone check

- **Status:** Accepted
- **Date:** 2026-06-24
- **Phase:** 3B (NIST AI RMF mapping)

## Context

Phase 3B requires mapping the stack's capabilities to the NIST AI RMF functions
(Govern / Map / Measure / Manage), being **honest about coverage gaps**, and
**framing the result for a procurement reviewer**. Unlike Phase 3A (OWASP), this
sub-phase feeds **no scorecard dimension** — it is a standalone governance artifact
(the scorecard's Governance-readiness dimension is computed from the EU AI Act
module in Phase 3C, not from NIST).

Three decisions: which NIST version to cite; what status vocabulary honestly
represents a *software stack's* relationship to an *organizational* framework; and
where the validation lives given there is no runtime consumer.

## Decision

### 1. Pin to AI RMF 1.0 (NIST AI 100-1), cite the GenAI Profile as companion

Re-verified at build time (2026-06-24): **AI RMF 1.0 (NIST AI 100-1, published
2023-01-26)** is the framework in force. A revision is in progress but unpublished,
so 1.0 is what the mapping cites; the version note records the revision status so
the citation is honest about currency. The **Generative AI Profile
(NIST-AI-600-1, 2024-07-26)** is referenced as a relevant companion for agentic
systems. The mapping is at the **category** level (19 categories across the four
functions) — function-level is too shallow to be credible to a procurement
reviewer; the 72 subcategories are the "100-page slog" the artifact exists to
spare them.

### 2. Shared-responsibility status model: `supported` / `partial` / `deployer-owned`

The AI RMF is an organizational risk-management framework; a stack is one input to
it, not a substitute. A status set of "covered/gap" (as in OWASP 3A) would
**mis-frame** the result — most of GOVERN is organizational by design, and marking
it a "gap" would imply a stack deficiency where none exists. Instead:

- **supported** — a shipped technical capability/evidence artifact serves the
  category (mechanism named);
- **partial** — the stack supplies inputs, but the outcome is substantially the
  deployer's process work;
- **deployer-owned** — a genuinely organizational control the stack cannot provide
  — a **responsibility boundary, not a deficiency**.

This is the procurement framing: it answers "what does adopting this stack help me
evidence, and what remains my program work?" The honest result is **8 supported,
6 partial, 5 deployer-owned** — strong on MEASURE/MANAGE (technical), explicitly
deferring most of GOVERN to the organization.

### 3. Validation is a self-contained check, not a package module

Because nothing at runtime consumes the NIST mapping (no scorecard dimension, no
CLI command), the OWASP pattern of putting a parser in `@grade-stack/scorecard`
does not apply — that would add code to a package that has no reason to import it.
`scripts/check-nist-coverage.ts` is **self-contained** (Bun only, plain structural
validation), mirroring `scripts/check-file-docs.ts`. It enforces completeness
(all 19 categories, each classified), evidence (supported/partial name a
mechanism), an explicit responsibility-boundary note on every category, and
README/JSON consistency. Wired into `bun run check` + CI.

## Consequences

- "Honest about coverage gaps" is enforced by a mechanism, consistent with the
  repo's core principle and the 3A precedent.
- The `deployer-owned` framing is reusable for Phase 3C (EU AI Act) where the same
  tool-vs-organization boundary recurs.
- Re-verification is a recurring duty: when the AI RMF revision publishes, the
  version pin and category set must be re-checked (the metadata records when they
  last were).

## Alternatives considered

- **Reuse OWASP's covered/partial/gap vocabulary.** Rejected — "gap" would
  mislabel organizational controls as stack deficiencies and read as dishonest to a
  procurement reviewer.
- **Map all 72 subcategories.** Rejected — defeats the "without the 100-page slog"
  purpose; category level is the right altitude for the audience.
- **Put the schema/parser in a package (or a new `@grade-stack/governance`).**
  Rejected for 3B — no runtime consumer; a self-contained check is the lighter,
  honest fit. Revisit a shared governance package only if a later phase needs one.
