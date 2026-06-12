---
description: Run the GRADE-Stack reliability eval suite against the reference agent
---

Run the Phase 1A eval suite and report the results.

Steps:

1. Run the suite via the CLI. Default to the local provider so the command is
   free and offline-friendly; pass through any provider the user named:

   ```bash
   bun run reliability eval run --provider ollama "$ARGUMENTS"
   ```

   Useful flags (surface these if the user asks):
   - `--provider bedrock|ollama` — the agent under test.
   - `--judge-provider bedrock|ollama` — the LLM-as-judge (defaults to `--provider`).
   - `--repeat <n>` — run each case N times to measure flakiness.
   - `--out <file>` — also write the structured JSON results.
   - `--json` — print structured JSON instead of the human summary.

2. Read the summary: per-case PASS/FAIL with the planner/executor/validator
   trace (`· execute · validate`), the pass rate, mean stability (flakiness),
   and agent token totals.

3. If cases failed, summarize *which validator checks* failed (JSON validity,
   required fields, enum ranges, category, or the judge) and whether the
   failures look like genuine agent weaknesses (expected — the agent is naive)
   or harness problems.

Do not modify the agent to make cases pass — Phase 1A only *measures*; the
agent is improved in later phases.
