# NIST AI RMF → GRADE-Stack mapping

This directory maps the GRADE-Stack reference stack to the **NIST AI Risk
Management Framework (AI RMF 1.0)** — all 19 categories across the four functions
(Govern, Map, Measure, Manage). It is written for a **procurement reviewer**: the
question it answers is *which AI RMF outcomes does adopting this stack help you
evidence, and which remain your organization's program work?*

Two forms, kept in lock-step by a CI check (`scripts/check-nist-coverage.ts`, in
`bun run check`):

- **Machine-readable:** [`nist-ai-rmf-1.0-mapping.json`](./nist-ai-rmf-1.0-mapping.json) — the source of truth.
- **Human-readable:** this file.

## Framework cited (verified at build time)

| Field | Value |
|---|---|
| Framework | **NIST AI Risk Management Framework (AI RMF 1.0)** |
| Publication | **NIST AI 100-1** |
| Version | **1.0** |
| Published | **2023-01-26** |
| Companion profile | **NIST-AI-600-1** — Generative AI Profile (2024-07-26) |
| Re-verified for this mapping | **2026-06-24** |
| Source | <https://doi.org/10.6028/NIST.AI.100-1> |

> **Version note.** A revision to the AI RMF is in progress as of 2026-06-24, but
> **1.0 (NIST AI 100-1) remains the published framework in force**, and is what
> this mapping cites. The Generative AI Profile (NIST-AI-600-1) is a relevant
> companion for agentic systems and is referenced where applicable.

## The honest framing: shared responsibility

The AI RMF is an **organizational** risk-management framework. A software stack is
**one input to it, not a substitute for it** — much like the shared-responsibility
model in cloud security. So this mapping uses three statuses, and the most
important one to read correctly is the third:

| Status | Meaning |
|---|---|
| 🟢 **Supported** | The stack ships a concrete technical capability or evidence artifact that directly serves this category (mechanism named). |
| 🟡 **Partial** | The stack supplies meaningful inputs, but the outcome is substantially organizational/process work the deployer completes. |
| ⚪ **Deployer-owned** | A genuinely organizational control the stack *cannot* provide. **This is a responsibility boundary, not a deficiency in the stack.** Any stack input is noted; the obligation is yours. |

A stack that claimed to "cover" GOVERN (org policy, accountability, workforce
processes) would be lying to you. The credible claim is narrower and more useful:
**this stack is strongest where the RMF asks you to *measure and manage* an AI
system technically, and it is explicit about leaving *governance program* work to
your organization.**

## Coverage by function

**8 supported · 6 partial · 5 deployer-owned** across 19 categories.

| Function | Supported | Partial | Deployer-owned | Reading |
|---|---|---|---|---|
| **GOVERN** (6) | 0 | 2 | 4 | Mostly your organization's program work; the stack supplies a board-legible communication artifact and supply-chain controls. |
| **MAP** (5) | 3 | 1 | 1 | The stack categorizes itself, benchmarks capability/cost, and ships a risk mapping (OWASP); societal-impact characterization is yours. |
| **MEASURE** (4) | 3 | 1 | 0 | The stack's strongest function — config-as-code evals, scorecard, baseline tracking, all in CI. |
| **MANAGE** (4) | 2 | 2 | 0 | Risk *response* is mechanized (gateway, eval-gate, turn bound); strategy and vendor due-diligence are yours. |

### GOVERN

| Category | Status | Stack contribution (or boundary) |
|---|---|---|
| GOVERN 1 — risk policies in place | ⚪ Deployer-owned | Assessment runbook + enforcement register as reusable inputs |
| GOVERN 2 — accountability structures | ⚪ Deployer-owned | Organizational; no stack input |
| GOVERN 3 — workforce diversity/equity/inclusion | ⚪ Deployer-owned | Out of a technical stack's scope entirely |
| GOVERN 4 — culture considers & communicates risk | 🟡 Partial | AI Reliability Scorecard serves the "communicates risk" half |
| GOVERN 5 — engagement with AI actors | ⚪ Deployer-owned | Open mappings are publishable inputs; the process is yours |
| GOVERN 6 — third-party / supply-chain policy | 🟡 Partial | Pinned lockfile + secret scan + OWASP ASI04 + NOTICE propagation |

### MAP

| Category | Status | Stack contribution (or boundary) |
|---|---|---|
| MAP 1 — context established | 🟡 Partial | Scoped task + PEV blueprint + assessment runbook (template) |
| MAP 2 — system categorized | 🟢 Supported | PEV blueprint + provider abstraction document the categorization |
| MAP 3 — capabilities/benefits/costs vs benchmarks | 🟢 Supported | Eval suite benchmarks + cost-per-success metric |
| MAP 4 — risks mapped incl. third-party | 🟢 Supported | OWASP Agentic Top 10 mapping + OOD/refusal eval cases |
| MAP 5 — societal impacts characterized | ⚪ Deployer-owned | Gateway PII handling is an input; characterization is yours |

### MEASURE

| Category | Status | Stack contribution (or boundary) |
|---|---|---|
| MEASURE 1 — methods & metrics applied | 🟢 Supported | promptfoo harness + reproducibility band + cost-per-success + trace coverage |
| MEASURE 2 — evaluated for trustworthy characteristics | 🟢 Supported | Scorecard dimensions + portable judge metric (fairness/privacy only partial — see note) |
| MEASURE 3 — risks tracked over time | 🟢 Supported | Eval-gate vs baseline + degraded canary + OTel traces |
| MEASURE 4 — feedback on measurement efficacy | 🟡 Partial | Per-case flakiness / stability reporting + tolerance band |

### MANAGE

| Category | Status | Stack contribution (or boundary) |
|---|---|---|
| MANAGE 1 — risks prioritized, responded to | 🟢 Supported | Gateway guardrails + eval-gate + enforced `--max-turns` |
| MANAGE 2 — strategies minimize negative impacts | 🟡 Partial | Guardrails + degraded canary + sovereign variant (strategy is yours) |
| MANAGE 3 — third-party risks managed | 🟡 Partial | Pinned lockfile + secret scan + OWASP ASI04 (due-diligence is yours) |
| MANAGE 4 — treatments documented & monitored | 🟢 Supported | OTel monitoring + scorecard + eval-gate CI + enforcement register |

## Per-category detail

The authoritative per-category detail — every named mechanism, its source
reference, and the responsibility boundary — lives in
[`nist-ai-rmf-1.0-mapping.json`](./nist-ai-rmf-1.0-mapping.json) so this document and
the machine-readable mapping cannot drift (the CI check enforces it).

## One honest caveat on MEASURE 2

NIST's "trustworthy characteristics" include fairness/bias-managed and
privacy-enhanced. The scorecard evaluates **valid-and-reliable**,
**secure-and-resilient**, and **accountable-and-transparent** characteristics
today; **fairness/bias and privacy** are only partially exercised (gateway PII
redaction). A deployer with fairness or privacy obligations must add targeted
measurement — this mapping says so rather than implying full trustworthy-AI
coverage.
