# ADR 0009 — OWASP Agentic Top 10: taxonomy pin, mapping format, and guardrail-coverage scoring

- **Status:** Accepted
- **Date:** 2026-06-23
- **Phase:** 3A (OWASP Agentic Top 10 mapping)

## Context

Phase 3A requires mapping the OWASP agentic threat taxonomy to concrete checks
and guardrails in the stack — machine-readable **and** human-readable — with **no
silent omissions**, and un-stubbing the scorecard's **Guardrail coverage**
dimension so it is computed from that mapping. The plan flagged two known hazards:

1. **The taxonomy has moved.** Earlier OWASP agentic-threat work used a `T1`–`T15`
   numbering; the published list had to be re-verified at build time and cited
   exactly, because mapping against a stale identifier scheme would be wrong on its
   face.
2. **"No silent omissions" is a `must` — so it needs a mechanism, not a sentence**
   (the repo's core principle). A prose promise that "every threat is addressed"
   binds nobody.

Three design questions: which taxonomy/version to pin; where the mapping lives and
in what form; and how guardrail coverage reduces to a board-legible rating.

## Decision

### 1. Taxonomy pinned: OWASP Top 10 for Agentic Applications **2026** (`ASI01:2026`–`ASI10:2026`)

Re-verified on **2026-06-23** against the OWASP GenAI Security Project listing
(<https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>,
edition **2026**, published **2025-12-09**) and corroborated across two independent
secondary sources. This is the **`ASI`** scheme, not the older `T1`–`T15`. The
version, identifier scheme, publication date, and re-verification date are recorded
in the mapping's metadata and the human-readable README, so the citation travels
with the data and onto the scorecard.

### 2. Mapping format: one JSON source of truth + a prose README, kept in lock-step by a check

- **Machine-readable source of truth:** `governance/owasp/owasp-agentic-top10-2026.json`
  — every threat as `{id, title, summary, status, mechanisms[], residualGap}`.
- **Human-readable:** `governance/owasp/README.md` — citation, methodology, and the
  covered/partial/gap table.
- **Status vocabulary:** `covered` (named shipped mechanism, residual limits
  stated) · `partial` (named mechanism with a stated residual gap) · `gap` (no
  mechanism — flagged, never assumed safe).

The scorecard logic (Zod schema, `parseOwaspMapping`, `computeGuardrailCoverage`)
lives in `@grade-stack/scorecard` and is **pure** — it never reads the file; the
CLI and the check script read the JSON and hand the parsed object in. This mirrors
the Phase 2D `TraceCoverage` seam (data computed at the edge, rating computed pure).

### 3. "No silent omissions" is enforced by a mechanism

`scripts/check-owasp-coverage.ts`, wired into `bun run check` (which CI runs),
fails the build when:

- any of the ten ASI ids is missing or duplicated;
- a `covered`/`partial` item names no mechanism;
- a `partial`/`gap` item states no residual gap;
- the README omits any threat id (machine/human mapping drift).

The Zod `parseOwaspMapping` carries the first three; the script adds the README
cross-check. This is the **register entry** for the rule, not a comment.

### 4. Guardrail coverage → rating: weighted score, transparent bands

`covered = 1.0`, `partial = 0.5`, `gap = 0.0`; score = mean weight over the ten
threats. Bands: `strong ≥ 0.9`, `adequate ≥ 0.7`, `at-risk ≥ 0.5`, `critical < 0.5`.
The evidence lines name the counts, the weighted score, and **every flagged gap by
id** — no black-box rating. Guardrail coverage rates the **stack's mechanisms**, so
it is **independent of the run** (and of degraded mode), unlike Reliability/Cost/
Observability — a property asserted by test.

## Consequences

- The reference stack's honest self-assessment today is **2 covered · 6 partial ·
  2 gaps** → weighted **0.5** → **At risk**. The two gaps (ASI06 Memory & Context
  Poisoning, ASI07 Insecure Inter-Agent Communication) are attack surfaces a
  single-agent, stateless architecture does not implement; they are flagged as
  gaps any memory-equipped or multi-agent deployment must close, rather than
  silently assumed safe.
- Because guardrail coverage now feeds the worst-wins rollup, the overall scorecard
  drops from Strong to **At risk** — the intended effect: the readout gets *more*
  honest as more dimensions come online, and it points a team straight at the work.
- Re-verification is a recurring duty: the OWASP edition and dates must be
  re-checked at each build boundary (the metadata records when they last were).

## Alternatives considered

- **A new `@grade-stack/governance` package.** Rejected for 3A — it would pull
  structure forward (3B/3C have not landed) and add a package the plan didn't
  enumerate. Revisit if NIST/EU AI Act modules want a shared home.
- **A hand-maintained second JSON Schema file.** Rejected — the Zod schema is the
  single enforced contract; a parallel JSON Schema would drift.
- **Inflating partials to "covered" to lift the rating.** Rejected outright — it
  violates the "no unsupported scores" contract the whole scorecard rests on. An
  honest *At risk* is the product.
