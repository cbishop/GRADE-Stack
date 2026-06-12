# Contributing to GRADE-Stack

Thanks for your interest. GRADE-Stack is built in public; contributions and issues
are welcome.

## Prerequisites

- [Bun](https://bun.sh) (see the version in CI; `bun --version`).
- For the Bedrock provider: AWS credentials with Bedrock access.
- For the Ollama provider: a local [Ollama](https://ollama.com) with a pulled model.

## Running locally

```bash
bun install
bun run reliability --help
bun run reliability agent run --provider ollama
```

## Before you open a PR

Run the full local gate — CI runs the same checks and will fail otherwise:

```bash
bun run typecheck   # tsc --noEmit (strict)
bun run check       # Biome lint + format
bun run test        # bun test
bun run build
```

We use **Biome** for lint and format (not ESLint/Prettier) — run `bun run check`
or install the Biome editor extension. New source files start with the two-line
SPDX header (see existing files).

## How PRs are gated

- Every PR runs typecheck, lint, test, build, and a secret scan (`gitleaks`) in CI.
- **No secrets in the repo.** Inject via environment variables; never commit
  credentials. A local pre-commit hook and the CI scan both enforce this — activate
  the local hook with `git config core.hooksPath .githooks`.
- **Eval gate (Phase 1B).** A PR that regresses agent quality below threshold is
  blocked automatically. The gate runs `reliability eval gate` against a
  deterministic, hermetic `stub` provider (no secrets, no spend — see
  [ADR 0003](docs/decisions/0003-eval-gate-stub-provider-and-baseline.md)) and
  compares against the committed `packages/evals/baseline.stub.json` within the
  Phase 1A ±1-case tolerance band. PRs run a 6-case smoke subset; pushes to `main`
  run the full suite.
  - **Fork PRs** ([ADR 0004](docs/decisions/0004-fork-pr-eval-strategy.md)): the
    `build` and `secret-scan` jobs always run, but the eval gate runs on a fork PR
    only after a maintainer applies the **`eval-approved`** label. The eval gate is
    a **required status check** (branch protection), so a fork PR cannot merge
    ungated.
  - To re-baseline after an intended quality change, regenerate and commit the
    baseline in a reviewed commit:
    `bun run reliability eval run --provider stub --out packages/evals/baseline.stub.json`.

> **Maintainer setup (one-time):** in GitHub repo settings, mark **`eval-gate (stub)`**
> (and the other CI jobs) as **required status checks** on `main`. This is what makes
> "a fork PR cannot merge ungated" a mechanism rather than a guideline.

## Scope

The repo stays narrow and opinionated. Please open an issue to discuss before
large additions.
