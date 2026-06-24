# governance

OWASP / NIST / EU AI Act / sovereignty mappings and governance artifacts (Phase 3).

| Module | Status | Feeds scorecard dimension |
|---|---|---|
| [`owasp/`](./owasp/) — OWASP Agentic Top 10 (2026) → stack mapping | ✅ Phase 3A | **Guardrail coverage** (computed) |
| [`nist/`](./nist/) — NIST AI RMF 1.0 mapping (procurement-framed) | ✅ Phase 3B | — (standalone artifact) |
| [`eu-ai-act/`](./eu-ai-act/) — EU AI Act deployer readout (re-verified 2026-06-24) | ✅ Phase 3C | **Governance readiness** (computed) |

- **OWASP** ([`owasp/README.md`](./owasp/README.md)) — covered/partial/gap mapping;
  the machine-readable source of truth feeds the scorecard's Guardrail-coverage
  dimension, and `scripts/check-owasp-coverage.ts` (in `bun run check` + CI)
  enforces "no silent omissions".
- **NIST** ([`nist/README.md`](./nist/README.md)) — AI RMF 1.0 mapping framed for a
  procurement reviewer using a shared-responsibility model (supported / partial /
  deployer-owned); standalone artifact (feeds no scorecard dimension);
  `scripts/check-nist-coverage.ts` (in `bun run check` + CI) enforces completeness
  and machine/human consistency.
- **EU AI Act** ([`eu-ai-act/README.md`](./eu-ai-act/README.md)) — deployer readout
  re-verified at build time (2026-06-24), distinguishing in-force vs. deferred,
  stating the Digital Omnibus's exact legal status and keeping the three penalty
  tiers distinct; the source-of-truth JSON feeds the scorecard's **Governance
  readiness** dimension (readiness, *not* legal compliance);
  `scripts/check-eu-ai-act.ts` (in `bun run check` + CI) enforces obligation honesty
  and that the readout still states the credibility-critical facts.
