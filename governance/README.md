# governance

OWASP / NIST / EU AI Act / sovereignty mappings and governance artifacts (Phase 3).

| Module | Status | Feeds scorecard dimension |
|---|---|---|
| [`owasp/`](./owasp/) — OWASP Agentic Top 10 (2026) → stack mapping | ✅ Phase 3A | **Guardrail coverage** (computed) |
| `nist/` — NIST AI RMF mapping | ⏳ Phase 3B | — |
| `eu-ai-act/` — EU AI Act deployer readout | ⏳ Phase 3C | **Governance readiness** |

See [`owasp/README.md`](./owasp/README.md) for the OWASP mapping, its citation, and
the covered/partial/gap table. The machine-readable source of truth
([`owasp/owasp-agentic-top10-2026.json`](./owasp/owasp-agentic-top10-2026.json)) is
what the scorecard's Guardrail-coverage dimension is computed from, and
`scripts/check-owasp-coverage.ts` (in `bun run check` + CI) enforces "no silent
omissions".
