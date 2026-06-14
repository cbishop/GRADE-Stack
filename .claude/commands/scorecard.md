---
description: Generate the one-page AI Reliability Scorecard from eval evidence
---

Generate the AI Reliability Scorecard — the board-legible trust/risk readout —
from the reference agent's eval results.

Steps:

1. Generate the scorecard via the CLI. Default to the deterministic, offline
   `stub` provider so it's free and reproducible; pass through any provider the
   user named:

   ```bash
   bun run reliability scorecard --provider stub "$ARGUMENTS"
   ```

   Useful flags (surface these if the user asks):
   - `--provider bedrock|ollama|stub` — the agent under test.
   - `--from <results.json>` — build from an existing `eval run` JSON instead of
     running the suite (fast, offline).
   - `--degraded` — run in degraded mode to demonstrate honest degradation
     (the scorecard ratings should drop).
   - `--format md|html|both` and `--out <path>` — write Markdown and/or a
     printable HTML page instead of printing to stdout.

2. Read the readout: an **Overall** verdict, then five executive dimensions —
   **Reliability** and **Cost discipline** are computed from eval evidence in
   Phase 1C; **Observability coverage**, **Guardrail coverage**, and
   **Governance readiness** are honestly shown as *not yet assessed* until the
   later phases that compute them (2D / 3A / 3C).

3. Every rating traces to the evidence beneath it — if the user questions a
   score, point them at the bullet evidence, not at a model opinion. No rating
   is asserted without supporting numbers.

The scorecard only *reports*; it never changes the agent. Improving the agent
happens in later phases.
