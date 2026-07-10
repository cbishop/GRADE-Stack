# GRADE-Stack

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

> **I help mid-market companies ship AI agents that are reliable, observable, and governed — the enterprise-grade version, right-sized for a company without an ML platform team.**

GRADE-Stack is the open reference stack for getting mid-market AI agents to
production. It is being built **in public**, one increment at a time: a naive
reference agent first, then the reliability, observability, and governance layers
that turn it into something a board can trust.

## What GRADE stands for

Five pillars, one per letter — the checks that separate a demo from a system in
durable production:

- **G — Governed.** You can show a board, an auditor, or a regulator who owns
  the agent, what it is allowed to do, and how those limits are enforced.
- **R — Reliable.** The agent behaves consistently under real conditions and
  volume, not just in the one path that looked good in the demo.
- **A — Agentic.** Right-sized agency: the agent has exactly the autonomy and
  tool access its job requires, and nothing more.
- **D — Deployed.** The system ships onto infrastructure a mid-market firm can
  actually run and operate — observable end to end, not a black box.
- **E — Evaluated.** Quality is measured before and after every change, so
  improvement is provable and a regression cannot ship quietly.

The CLI binary is named **`reliability`** — the product name (`GRADE-Stack`) and
the command name (`reliability`) are intentionally different.

## Status

🚧 **Phase 0 — Foundation.** What works today:

- A provider abstraction (`@grade-stack/core`) through which **all** model calls
  flow, with **Amazon Bedrock** and **Ollama** implementations.
- A deliberately **naive** reference agent (`reference-agent/`) that triages an
  inbound support email and drafts a structured response — the documented
  "before" state.
- The `reliability` CLI, baseline CI, and a layered secret-scan mechanism.

No evals, tracing, MCP, gateway, or governance yet — those land in later phases.
See [`docs/PLAN-Grade-Stack-v2.md`](docs/PLAN-Grade-Stack-v2.md) for the roadmap
and [`docs/PRD-Grade-Stack-v2.md`](docs/PRD-Grade-Stack-v2.md) for the contract.

## Quickstart

Requires [Bun](https://bun.sh). For the Bedrock provider you need AWS credentials
with Bedrock access (the `us-east-1` cross-region Claude inference profiles); for
Ollama you need a local [Ollama](https://ollama.com) with a pulled model.

```bash
bun install
bun run reliability --help

# Run the naive reference agent end to end:
bun run reliability agent run --provider ollama
bun run reliability agent run --provider bedrock
```

Provider selection precedence: `--provider` flag → `RELIABILITY_PROVIDER` env →
default (`ollama`). Models are overridable via `RELIABILITY_BEDROCK_MODEL` /
`RELIABILITY_OLLAMA_MODEL`.

## Layout

```
packages/
  core/         provider abstraction + shared types (the spine)
  cli/          the `reliability` Commander CLI
  evals/        eval harness            (Phase 1A)
  scorecard/    AI Reliability Scorecard (Phase 1C)
  mcp-server/   MCP integration layer   (Phase 2B)
  gateway/      LLM gateway / guardrails (Phase 2C)
reference-agent/  the one task the whole build is measured on
governance/       OWASP / NIST / EU AI Act mappings (Phase 3)
content/          build-in-public artifacts, per cycle
docs/             PRD, plan, and ADRs
```

## Development

```bash
bun run typecheck   # tsc --noEmit (strict)
bun run check       # Biome lint + format check
bun run test        # bun test
bun run build       # bundle the CLI
```

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 Inbound Team, LLC doing business as Clarke Bishop Consulting
(https://clarkebishop.com).

Forks and derivative works must retain the attribution notices in
[`NOTICE`](NOTICE), as required by Section 4(d) of the license.
