# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## The core principle: mechanisms, not prose

Where a rule says "must never" (no secrets in the repo, no internal docs
published, no ungated PR merges), **enforce it with a mechanism — a hook, a
schema, or a CI gate — never with a sentence in a doc.** A prose instruction
binds nobody; a failing check binds everybody. This is a product design
principle for the stack, not just a build convention. If you find yourself
writing "remember to…", stop and write the mechanism instead.

Current enforcement mechanisms:

- **Secret scan** — three layers. CI `gitleaks` (`.github/workflows/ci.yml`) is
  the **mechanism of record**. The git `pre-commit` hook (`.githooks/pre-commit`)
  and the Claude Code `PreToolUse` hook (`.claude/settings.json`) are fast local
  feedback only — both are per-clone/opt-in and must never be the sole defense.
- **Public/private split** — the `pre-commit` hook blocks committing anything
  under `docs/internal/`; `.gitignore` keeps it from being staged by accident.
- **Eval gate** — a placeholder no-op `Stop` hook today; wired to block on eval
  regressions in Phase 1B.

## Stack & conventions

- **Runtime/toolchain:** Bun only. No npm/yarn/pnpm. TypeScript `strict`.
- **CLI:** Commander. The binary is `reliability`; the product is GRADE-Stack.
- **Lint/format:** Biome (`bun run check`). See `docs/decisions/0001-*`.
- **Provider abstraction:** every model call goes through `@grade-stack/core`
  (`ModelProvider`). Never call Bedrock/Ollama SDKs directly from feature code.
- **Per-file headers:** source files start with the two-line SPDX header
  (`Copyright … Clarke Bishop Consulting` + `SPDX-License-Identifier: Apache-2.0`).
- **One sub-phase per branch.** Implement only the current sub-phase; stop at its
  acceptance criteria. Pull no scope forward.
- **Record deviations as ADRs** in `docs/decisions/` — never silently depart from
  the PRD's stated stack.

## Local gate (run before pushing)

```bash
bun run typecheck && bun run check && bun run test && bun run build
```

## Source of truth

- `docs/PRD-Grade-Stack-v2.md` — what, and the acceptance contract.
- `docs/PLAN-Grade-Stack-v2.md` — how, and in what order (the progress ledger).
- Ignore `*-v1` / `*-Grade-stack.md` (superseded) and `docs/internal/` (never committed).
