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
- An **eval gate** lands in Phase 1B: PRs that regress agent quality below
  threshold will be blocked automatically. Because GitHub Actions does not expose
  repo secrets to fork PRs, the eval gate runs on same-repo PRs and pushes to
  `main`; **fork PRs** get lint/typecheck/test and a maintainer-applied label that
  triggers the eval run after review. (Details ship with Phase 1B.)

## Scope

The repo stays narrow and opinionated. Please open an issue to discuss before
large additions.
