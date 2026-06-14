# @grade-stack/scorecard

The **AI Reliability Scorecard** — a one-page, board-legible trust/risk readout
built entirely from eval evidence. Phase 1C.

It turns a `reliability eval run` result into five executive dimensions:

| Dimension | Source | Status in 1C |
|---|---|---|
| **Reliability** | pass rate + run-to-run stability | computed |
| **Cost discipline** | cost-per-success + waste fraction | computed |
| **Observability coverage** | OpenTelemetry trace coverage | stubbed → Phase 2D |
| **Guardrail coverage** | OWASP Agentic Top 10 mapping | stubbed → Phase 3A |
| **Governance readiness** | EU AI Act deployer module | stubbed → Phase 3C |

Every rating traces to the numbers beneath it — there are **no unsupported
scores**. Stubbed dimensions say "not yet assessed" and name the phase that
computes them, rather than guessing.

## Use

```bash
# Run the suite and print a Markdown scorecard (stub provider — free, offline)
bun run reliability scorecard --provider stub

# Build from an existing eval results file, write Markdown + printable HTML
bun run reliability scorecard --from results.json --format both --out scorecard

# Honest degradation: a deliberately worsened agent earns a worse scorecard
bun run reliability scorecard --provider stub --degraded
```

`buildScorecard(result)` is pure — it carries the eval run's timestamp rather
than reading the clock, so the same eval input always yields the same scorecard.
