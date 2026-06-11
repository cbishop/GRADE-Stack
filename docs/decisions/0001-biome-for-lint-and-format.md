# ADR 0001 — Biome for lint + format

- **Status:** Accepted
- **Date:** 2026-06-11
- **Phase:** 0 (Foundation)

## Context

Phase 0 task 2 requires a lint + format toolchain and an ADR if the choice
deviates from any stated default. The PRD stack table does not mandate a specific
linter/formatter, so this is an open decision recorded here.

The realistic options were **Biome** (single Rust-based tool for both lint and
format) and the conventional **ESLint + Prettier** pair.

## Decision

Use **Biome** (`@biomejs/biome`) as the single lint + format tool for the whole
monorepo. Config lives in `biome.json` at the repo root; CI runs `biome check`.

## Rationale

- **One tool, one config** — no ESLint/Prettier dependency sprawl or
  rule-vs-format conflicts to reconcile.
- **Speed** — Rust-based; near-instant on the full tree, which keeps the CI lint
  step and the pre-commit feedback loop cheap.
- **Bun fit** — installs as a single binary, no plugin matrix to maintain.

## Consequences

- Smaller plugin ecosystem than ESLint. If a future phase needs a lint rule Biome
  cannot express (e.g. a bespoke MCP or governance rule), revisit — either add a
  narrowly-scoped ESLint pass for that rule or contribute/await a Biome rule.
- Contributors must run `bun run check` (or have the Biome editor extension)
  rather than the more familiar ESLint/Prettier setup. Documented in
  `CONTRIBUTING.md`.
