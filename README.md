# GRADE-Stack

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

> **I help mid-market companies ship AI agents that are reliable, observable, and governed: the enterprise-grade version, right-sized for a company without an ML platform team.**

GRADE-Stack is the open reference stack for getting mid-market AI agents to
production. It was built **in public** over 13 increments: a naive reference
agent first, then the reliability, observability, and governance layers that
turn it into something a board can trust. The build is complete; a cycle-by-cycle
walkthrough series is now running on
[LinkedIn](https://www.linkedin.com/in/clarkebishop/).

## What GRADE stands for

Five pillars, one per letter, and the checks that separate a demo from a system
in durable production:

- **G · Governed.** You can show a board, an auditor, or a regulator who owns
  the agent, what it is allowed to do, and how those limits are enforced.
- **R · Reliable.** The agent behaves consistently under real conditions and
  volume, not only in the one path that looked good in the demo.
- **A · Agentic.** Right-sized agency: the agent has exactly the autonomy and
  tool access its job requires, and nothing more.
- **D · Deployed.** The system ships onto infrastructure a mid-market firm can
  actually run and operate: observable end to end, not a black box.
- **E · Evaluated.** Quality is measured before and after every change, so
  improvement is provable and a regression cannot ship quietly.

The CLI binary is named **`reliability`**: the product name (`GRADE-Stack`) and
the command name (`reliability`) are intentionally different.

## Status

✅ **Build complete: 13 cycles, all five pillars live.** What works today:

- A provider abstraction (`@grade-stack/core`) through which **all** model calls
  flow, with **Amazon Bedrock** and **Ollama** implementations.
- The reference agent (`reference-agent/`), restructured from a naive single
  call into a **Planner → Executor → Validator** loop with a code-enforced
  output contract (0/12 → 11/12 on the same model; see
  [`docs/blueprint-planner-executor-validator.md`](docs/blueprint-planner-executor-validator.md)).
- A **12-case eval harness** with an LLM judge, cost-per-success tracking, and a
  **CI gate** that fails the build on quality regressions (`packages/evals/`).
- The **AI Reliability Scorecard**: a board-legible, evidence-backed rating
  across all five dimensions, rendered as CLI, Markdown, or printable HTML
  ([sample](content/cycle-12/sample-scorecard.md)) (`packages/scorecard/`).
- An **LLM gateway** with server-side guardrails and structural credential
  isolation (the agent process holds zero provider credentials), plus an **MCP
  integration layer** with description-driven tool selection
  (`packages/gateway/`, `packages/mcp-server/`).
- **OpenTelemetry tracing** (GenAI conventions; Phoenix by default) so every
  agent run is one connected, inspectable trace.
- **Governance mappings with teeth**: OWASP Agentic Top 10 (2026), NIST AI RMF
  1.0, and an EU AI Act deployer readout. Each threat or obligation maps to
  a concrete mechanism in this repo or an honest gap, enforced by CI checks
  (`governance/`).
- A **sovereign / air-gapped variant** with a live egress-verification proof
  (`reliability sovereign verify`).

What's next: the confidence router (ADR 0015) is merged and awaiting its
write-up. History: [`docs/PLAN-Grade-Stack-v2.md`](docs/PLAN-Grade-Stack-v2.md)
is the cycle-by-cycle ledger, [`docs/PRD-Grade-Stack-v2.md`](docs/PRD-Grade-Stack-v2.md)
the contract, and [`docs/post-mortem.md`](docs/post-mortem.md) the honest
self-review that closed the build.

## Quickstart

Requires [Bun](https://bun.sh). For the Bedrock provider you need AWS credentials
with Bedrock access (the `us-east-1` cross-region Claude inference profiles); for
Ollama you need a local [Ollama](https://ollama.com) with a pulled model.

```bash
bun install
bun run reliability --help

# Run the reference agent end to end:
bun run reliability agent run --provider ollama
bun run reliability agent run --provider bedrock

# The finished system in three commands:
bun run reliability eval run --provider ollama   # 12-case suite + LLM judge
bun run reliability scorecard --format both -o card   # the board-legible artifact
bun run reliability gateway demo                 # guardrails + credential isolation, live
```

Provider selection precedence: `--provider` flag → `RELIABILITY_PROVIDER` env →
default (`ollama`). Models are overridable via `RELIABILITY_BEDROCK_MODEL` /
`RELIABILITY_OLLAMA_MODEL`.

## Layout

```
packages/
  core/         provider abstraction, PEV loop, tracing, airgap guard (the spine)
  cli/          the `reliability` Commander CLI
  evals/        eval harness, CI gate, cost-per-success
  scorecard/    AI Reliability Scorecard (CLI / Markdown / HTML)
  mcp-server/   MCP integration layer
  gateway/      LLM gateway: guardrails, sandbox, confidence router
reference-agent/  the one task the whole build is measured on
governance/       OWASP / NIST / EU AI Act mappings (machine-readable + CI-checked)
content/          build-in-public artifacts, per cycle
docs/             PRD, plan ledger, 15 ADRs, post-mortem
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
