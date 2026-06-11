# PRD — Mid-Market Agentic AI Reliability & Governance Reference Stack

**Owner:** Clarke Bishop · **Format:** Product Requirements Document for Claude Code · **Status:** v2 (build plan)

**One-line product definition:** A public, vendor-neutral, opinionated open-source stack — plus an executive-level methodology — that shows mid-market companies (no ML platform team) how to take an AI agent from demo to *governed, observable, evaluated, secure production*.

---

## Changes from v1

- **Phase 0:** LICENSE + CONTRIBUTING/SECURITY.md are now deliverables (the repo isn't legally forkable without one); a baseline CI workflow (typecheck, lint, test, build, secret scan) lands in Phase 0 instead of waiting for 1B.
- **Secret scanning:** the *authoritative* mechanism is now a CI secret scan; the local PreToolUse and pre-commit hooks are fast-feedback layers, not the enforcement (local hooks are per-clone opt-in and can't bind contributors).
- **Phase 1A:** any LLM-as-judge/grader metric must run through the provider abstraction (swappable to Ollama) — required so the Phase 3D air-gapped variant doesn't break. Reproducibility acceptance restated as tolerance-based (Bedrock has no seed parameter; bit-identical output is not achievable).
- **Phase 1B:** the eval gate must define a fork-PR strategy (GitHub does not expose secrets to fork PRs), a committed-baseline comparison mechanism with a flakiness tolerance band, and a CI cost cap (reduced suite on PRs, full suite on main). Cost-per-success semantics defined for the \$0-per-token local provider.
- **Phase 2C:** acceptance now requires *structural* enforcement — after 2C the agent process holds no model-provider credentials and the gateway is the only path to models. A gateway the agent can route around in code would violate the "mechanisms not prose" principle.
- **Phases 3A/3C:** verify current OWASP Agentic identifiers and EU AI Act dates *at build time* — both are moving targets between now and weeks 17–22.
- **Slash commands** (`/eval-run`, `/scorecard`) — named in the v1 repo structure but never scheduled — are now explicit tasks in 1A/1C.

---

## How to use this PRD with Claude Code

This document is the source of truth for the build. Point Claude Code at it from the repo root.

- **Work one sub-phase at a time.** Each sub-phase is a bi-weekly increment with its own acceptance criteria and a build-in-public artifact. Do not pull scope forward from a later phase.
- **The acceptance criteria are the contract.** A sub-phase is "done" only when every box is checked and the build-in-public artifact for that cycle exists in `/content`.
- **Respect the stack constraints** in the section below — Bun + TypeScript throughout, Commander for the CLI, promptfoo as the primary eval engine. Do not introduce a new framework without an explicit decision recorded in `/docs/decisions/`.
- **Enforce with mechanisms, not prose.** Where this PRD says "must never," implement it as a hook, schema, or CI gate — not a CLAUDE.md instruction. (This is a deliberate design principle of the product itself, not just the build.)
- **Suggested kickoff prompt:** *"Read PRD-Grade-Stack-v2.md and CLAUDE.md. We are starting Phase [X.Y]. List the concrete tasks, propose a branch name, and implement only that sub-phase. Stop at its acceptance criteria."*

---

## Product context

**The problem.** Mid-market companies (\$50M–\$500M revenue) can call a frontier model in one API request but cannot tell whether their agent is reliable, observable, governed, secure, or cost-controlled. The gap is operational maturity, not capability. Surveys put agents-in-production between ~42% (IDC) and ~57% (LangChain) of sampled orgs, with far fewer *scaled* — and the cited failure causes are operational (legacy integration, inconsistent output at volume, missing eval/monitoring, unclear ownership, weak data foundations), not model quality.

**The focus.** This project targets the *executive/board* translation of agent reliability: a vendor-neutral, board-explainable synthesis right-sized for mid-market. It deliberately does **not** compete in the developer/PM evals tooling space — that depth is explicitly out of scope here.

**Build philosophy.** This is a build-in-public reference project. Optimize every phase for "narratable in public" and for being a clear, forkable reference — not for feature completeness.

**Primary success metric (technical):** a working, opinionated, narrow agent + eval harness that a handful of real practitioners fork or reference.

---

## Stack & constraints (non-negotiable unless a decision record overrides)

**Language decision (decided on merits, not fluency):** TypeScript throughout. The product's spine is the MCP/agent/gateway *integration* layer, which is where language choice has first-class-vs-workable consequences rather than mere preference — and TS serves it best (first-class MCP SDK, clean Zod→tool-schema enforcement story, solid Bedrock JS SDK). The eval depth where Python dominates is the axis this product deliberately does *not* compete on (out of scope), so "going Python for the evals" would buy capability the reader never sees at the cost of a second toolchain. A clean-seam polyglot opening is preserved below for the one case where it's genuinely warranted.

| Layer | Choice | Notes |
|---|---|---|
| Runtime / package manager | **Bun** | One toolchain, fast. No npm/yarn/pnpm mixing. |
| Language | **TypeScript** (strict) | `strict: true`, no implicit `any`. Single language for everything a reader or forker touches. |
| CLI framework | **Commander** | Single `reliability` CLI binary; subcommands per capability. |
| Primary eval engine | **promptfoo** | TS/Node-native; the default. Config-as-code, CI-friendly. *(Known risk: promptfoo targets Node — if it misbehaves under Bun, invoke its CLI as a subprocess rather than re-opening the stack decision.)* |
| Optional eval components | **DeepEval, Phoenix/Arize, RAGAS** | Python-first. Reach for these *only* via the escape hatch below — a named metric genuinely unavailable in promptfoo. Record the reason as an ADR. |
| Tracing / observability | **OpenTelemetry** (OTel) | GenAI semantic conventions. Phoenix or any OTLP backend as a viewer. |
| Tool/integration layer | **MCP** (TypeScript SDK) | At least one MCP server (tool) + one resource by Phase 2. |
| Models — cloud | **Amazon Bedrock** (Claude) | Production path. |
| Models — local | **Ollama** on M4 Mac Studio (qwen3.5, deepseek-r1, llama3.3) | Dev/variant path; the basis for the Phase 3 sovereign variant. |
| Guardrails | **LLM gateway** (provider-agnostic) | Sits between app and models; enforces policy server-side. From Phase 2C, the **only** path to models — the agent holds no provider credentials. |
| Reference agent pattern | **Planner / Executor / Validator** | The canonical pattern the stack demonstrates. |
| License | **Apache-2.0** (default) | Required before the repo goes public. Record an ADR if a different license is chosen. |

**Hard constraints:**
- **Time budget:** sequenced work, no parallel phases. The schedule assumes a single maintainer.
- **OSS scope discipline:** the repo stays *narrow and opinionated*. If maintenance burden grows, cut repo scope — never cut publishing cadence.
- **Mid-market scoping is the differentiator.** Every artifact must be legible to a non-ML-platform team and a non-technical executive. If a deliverable can't be explained to a board, it's mis-scoped.
- **No secrets in the repo.** Inject via env. Authoritative enforcement is a **CI secret scan**; local PreToolUse and pre-commit hooks provide fast feedback but are not the mechanism of record (they're per-clone opt-in).
- **All model access goes through the provider abstraction** — including any LLM-as-judge/grader calls in the eval harness. This is what makes the Phase 2C gateway insertion and the Phase 3D air-gapped variant structurally possible rather than retrofits.

**Language escape hatch (the only sanctioned path to non-TS code):** Default is TS-only. Introduce Python *only* in one of two ways, in this order of preference:

1. **Isolated scorer (preferred).** A specific, named eval metric is genuinely unavailable in promptfoo → add one Python scorer behind a subprocess (or HTTP/OTel) boundary. It is a leaf, not a layer. Everything a reader or forker touches stays TS.
2. **Clean-seam split (only if a whole layer earns it).** If a *layer* — realistically only the eval/scoring package, or a future ML-analysis component — proves materially better in Python AND already sits behind a process/protocol boundary, it may move to Python wholesale. The MCP server stays TS regardless (its SDK is first-class and it's the integration spine). The seam must be a real protocol boundary (subprocess, HTTP, OTLP) so the two sides barely touch and carry no shared-build tax. This is the *"each layer in its best language, clean seam"* option — permitted, but it must clear the bar of "this layer is genuinely better in Python," not "I'd prefer Python here."

**The tripwire that would flip the whole decision:** if the product later requires real ML work — custom embeddings analysis, fine-tuning, or statistical analysis of eval results at scale — Python stops being optional and TS-throughout becomes the wrong default. Nothing in the current scope requires this; revisit only if scope changes. Any move under this section is recorded as an ADR in `/docs/decisions/`.

---

## Repository structure (target)

```
<repo-name>/                   # public repo name decided in pre-flight (brand decision)
├── CLAUDE.md                  # build conventions + "use mechanisms not prose" rules
├── LICENSE                    # Apache-2.0 (default) — required before going public
├── CONTRIBUTING.md            # minimal: how to run, how PRs are gated
├── SECURITY.md                # minimal: how to report a vulnerability
├── PRD-Grade-Stack-v2.md
├── packages/
│   ├── cli/                   # Commander CLI ("reliability ...")
│   ├── core/                  # planner/executor/validator, shared types, provider abstraction
│   ├── evals/                 # promptfoo configs, scorers, cost-per-success
│   ├── mcp-server/            # MCP server (tools + resources)
│   ├── gateway/               # LLM gateway / guardrail layer
│   └── scorecard/             # board-level AI Reliability Scorecard generator
├── reference-agent/           # the narrow demo agent the whole stack proves out
├── governance/                # OWASP/NIST/EU AI Act mappings (markdown + machine-readable)
├── docs/
│   └── decisions/             # ADRs — every stack deviation recorded here
├── content/                   # build-in-public drafts, one folder per cycle
│   └── cycle-XX/
├── .github/workflows/         # CI: typecheck/lint/test/build + secret scan (Phase 0); eval gate (1B)
└── .claude/
    ├── commands/              # slash commands: /eval-run (1A), /scorecard (1C)
    └── settings.json          # hooks: pre-commit secret scan (fast feedback), eval-gate
```

---

## Cadence model

- **Bi-weekly phase gate.** Each lettered sub-phase (e.g. 1A) is a ~2-week increment that ends in a shippable, narratable deliverable.
- **Weekly posting beat.** Two posts per sub-phase: a mid-cycle "working on / what surprised me" post and an end-of-cycle "shipped / here's the artifact" post. Drafts live in `/content/cycle-XX/`.
- **Posting split:** ~80% practice-in-public (LinkedIn-primary narrative), ~15% technical artifact (the repo/commits as credibility), ~5% pure transparency (a retrospective at each phase boundary).
- **Definition of "narratable":** if you can't write the end-of-cycle post from the increment, the increment isn't done.

---

## Phase 0 — Foundation & flag-planting (Weeks 1–2)

**Objective:** Stand up the repo and publicly declare the point of view. Establish the spine before any feature.

**Deliverables**
- Bun + TypeScript monorepo scaffold matching the target structure (empty packages with README stubs are fine).
- **LICENSE (Apache-2.0 default; ADR if different), CONTRIBUTING.md, SECURITY.md** — committed *before* the repo goes public.
- `CLAUDE.md` encoding the build conventions and the "mechanisms not prose" principle.
- **Baseline CI** (GitHub Actions): install, typecheck, lint, `bun test` (with at least one real unit test so the scaffold isn't vacuous), build, and a **CI secret scan** (e.g. gitleaks). Phase 1B *extends* this workflow with the eval gate; it does not introduce CI.
- `.claude/settings.json` with a **PreToolUse / pre-commit hook that blocks committed secrets** (fast local feedback; CI is the mechanism of record) and a placeholder **eval-gate hook**.
- A *single, narrow* `reference-agent` skeleton (one realistic mid-market task — e.g. "triage an inbound support email and draft a structured response") that runs end to end against Bedrock and Ollama, with zero reliability tooling yet. This is intentionally naive; it's the "before" state.
- **Provider abstraction** through which *all* model calls flow — the agent now, the eval judge in 1A, the gateway seam in 2C, the air-gapped variant in 3D.
- POV statement committed to the repo README: *"I help mid-market companies ship AI agents that are reliable, observable, and governed — the enterprise-grade version, right-sized for a company without an ML platform team."*

**Technical tasks**
- Init Bun workspace; configure strict TS, lint, format.
- Wire the Commander CLI entrypoint (`reliability --help` works).
- Provider abstraction so the reference agent can target Bedrock or Ollama via a flag/env.
- Commit the secret-scanning hook and CI scan; verify **both** fire on a test secret.
- Stand up the baseline CI workflow and confirm it passes from a clean clone.

**Acceptance criteria**
- [ ] `bun install && bun run reliability --help` works from a clean clone.
- [ ] Reference agent completes its one task against both Bedrock and Ollama.
- [ ] A deliberately planted test secret is blocked by the local hook **and** caught by the CI scan.
- [ ] Baseline CI (typecheck, lint, test, build, secret scan) passes on the initial push.
- [ ] LICENSE, CONTRIBUTING.md, SECURITY.md exist; repo is public; README states the POV.
- [ ] **Build-in-public artifact:** launch post ("I'm building the open reference stack for getting mid-market AI agents to production, in public — here's the repo and why") in `/content/cycle-00/`.

**Out of scope:** any evals, tracing, MCP, gateway, governance. Resist all of it.

---

## Phase 1 — The eval/reliability harness MVP (Weeks 3–8)

The highest-leverage phase. This is the foundation everything else builds on.

### Phase 1A — Core eval harness (Weeks 3–4)

**Objective:** Make the naive reference agent *measurable*.

**Deliverables**
- `packages/evals` with a promptfoo config-as-code setup targeting the reference agent.
- A starter eval suite: at least 10 cases spanning the real input distribution, **including a refusal/empty/out-of-distribution case** (to surface mode-collapse-style failures).
- **Trace-level scoring**: each eval records not just pass/fail but per-step outcomes for the planner/executor/validator path.
- **Judge-model portability:** any LLM-as-judge/grader metric runs through the provider abstraction and is demonstrably swappable to Ollama. (This is a Phase 3D air-gap prerequisite — cheap to honor now, expensive to retrofit at week 23.)
- `reliability eval run` CLI subcommand, plus the `/eval-run` slash command in `.claude/commands/`.

**Acceptance criteria**
- [ ] `reliability eval run` executes the suite and emits structured (JSON) results.
- [ ] Suite includes ≥1 null/refusal case and cases structurally identical to production inputs.
- [ ] **Reproducibility (tolerance-based):** aggregate scores from two consecutive runs agree within a stated tolerance band, and per-case flakiness is reported. (Bedrock offers no seed parameter; bit-identical output is not the bar. Document what is and isn't deterministic per provider.)
- [ ] At least one judge-based metric runs successfully with an Ollama judge.
- [ ] **Artifact:** post on "the cheapest reliability win is making your agent measurable — here's a 10-case harness."

### Phase 1B — CI gating + cost-per-success (Weeks 5–6)

**Objective:** Turn evals into an enforcement mechanism and introduce the executive-legible unit metric.

**Deliverables**
- Extend the Phase 0 GitHub Actions workflow to run the eval suite; **the eval-gate now fails the build on regression** (programmatic enforcement, not advisory).
- **Baseline mechanism (ADR):** the comparison baseline is a committed JSON results file on `main`, updated only by an explicit re-baseline commit; the gate compares against it within the 1A tolerance band so nondeterminism doesn't flake the gate.
- **Fork-PR strategy (ADR):** GitHub Actions does not expose secrets to fork PRs, so the Bedrock-backed eval gate cannot run on them. Choose and record one: (a) eval gate on same-repo PRs + pushes to `main`, with fork PRs gated on lint/typecheck/test only and a maintainer-applied label triggering the eval run; (b) a local-model (Ollama-in-CI or hosted) reduced suite for forks; or (c) maintainer-triggered `workflow_dispatch`. Whatever the choice, a fork PR must not silently merge ungated.
- **CI cost cap:** a reduced smoke suite on PRs, the full suite on `main` (or nightly); per-run budget cap so a misbehaving PR can't burn unbounded Bedrock spend.
- **Cost-per-success** as a first-class metric: token + dollar cost per *passing* outcome, not per call. Surfaced in the JSON results and CLI output. Per-provider pricing lives in config; **Ollama semantics defined explicitly** — token counts always reported, dollar figure defaults to \$0 with an optional amortized-hardware rate, so the metric is honest on the local path and feeds the 3D trade-off doc.
- `--max-turns` / loop-bounding on the reference agent to prevent runaway cost.
- **Degraded mode:** a flag on the reference agent that deliberately worsens it — used here to prove the gate blocks a regression, reused in 1C for the scorecard's honest-degradation test, and kept as a permanent canary.

**Acceptance criteria**
- [ ] A PR that degrades agent quality below threshold is blocked by CI automatically (demonstrated via degraded mode).
- [ ] The fork-PR strategy and baseline mechanism are recorded as ADRs and implemented; a fork PR cannot merge ungated.
- [ ] `reliability eval run` reports cost-per-success per scenario, with defined semantics on both providers.
- [ ] Runaway loops are bounded and the bound is enforced, not suggested.
- [ ] **Artifact:** post on "cost-per-success is the metric your board actually understands — why cost-per-call lies."

### Phase 1C — AI Reliability Scorecard v1 (Weeks 7–8) · *the executive-facing deliverable*

**Objective:** Translate eval results into a board-legible trust/risk readout. This is the single most executive-facing artifact in the product.

**Deliverables**
- `packages/scorecard` generates a one-page **AI Reliability Scorecard** from eval results: a small set of executive dimensions (e.g. *Reliability*, *Cost discipline*, *Observability coverage*, *Guardrail coverage*, *Governance readiness* — last two stubbed until later phases) each with a plain-language rating and the evidence behind it.
- Output as Markdown + a clean printable HTML; no jargon a CFO wouldn't understand.
- `reliability scorecard` CLI subcommand, plus the `/scorecard` slash command in `.claude/commands/`.

**Acceptance criteria**
- [ ] Running the scorecard against the reference agent produces a one-page readout an executive could read in 3 minutes.
- [ ] Every rating traces to underlying eval evidence (no unsupported scores).
- [ ] Ratings degrade honestly — demonstrated by running the scorecard against the agent in 1B's degraded mode.
- [ ] **Artifact:** publish a sample scorecard + post: "How a board can tell if its AI agent is trustworthy — without reading a single trace." This is the flagship public artifact.

**Phase 1 gate:** Do not proceed to Phase 2 until the scorecard has been published. *If the executive narrative isn't landing after ~8 weeks of consistent posting, the framing is too technical — refine the scorecard/narrative for the executive reader before adding any architecture scope.*

---

## Phase 2 — Reference architecture + MCP integration (Weeks 9–16)

**Objective:** Promote the naive reference agent into a credible, vendor-neutral reference architecture, and add the integration layer.

### Phase 2A — Planner/Executor/Validator pattern (Weeks 9–10)
- Refactor the reference agent into an explicit planner → executor → validator structure in `packages/core`.
- The **validator** uses structured output (tool-use / schema-enforced) rather than prompted JSON.
- **Acceptance:** the pattern is documented as a reusable blueprint; eval scores hold or improve through the refactor.
- **Artifact:** post on the planner/executor/validator pattern as the mid-market default.

### Phase 2B — MCP integration layer (Weeks 11–12)
- `packages/mcp-server` exposing **at least one tool and one resource**, correctly distinguished (model-controlled action vs. app-exposed data).
- Reference agent consumes the MCP server.
- **Acceptance:** tool vs. resource choice is defensible per the control model; tool descriptions (not names or prompt rules) drive selection; transports documented (stdio local / HTTP remote).
- **Artifact:** post on "the tool-vs-resource mistake every team makes with MCP."

### Phase 2C — LLM gateway / guardrails (Weeks 13–14)
- `packages/gateway` sits between agent and models, enforcing policy **server-side** (input/output filters, PII handling, allow/deny).
- **Credential isolation (the structural mechanism):** after 2C, the agent process holds **no model-provider credentials**; the provider abstraction targets only the gateway endpoint, and the gateway alone holds Bedrock/Ollama access. A gateway the agent can route around in code is prose, not a mechanism.
- **Acceptance:** a guardrail violation is blocked at the gateway even when the agent prompt is manipulated to bypass it **and** a direct-to-provider call from the agent process fails for lack of credentials (proving enforcement is structural, not behavioral).
- **Artifact:** post on why guardrails belong in the gateway, not the prompt.

### Phase 2D — OpenTelemetry tracing (Weeks 15–16)
- Instrument the full path with OTel GenAI semantic conventions; export to an OTLP backend (Phoenix or similar) for viewing.
- Scorecard's *Observability coverage* dimension now computed from real trace coverage.
- **Acceptance:** a full agent run produces a connected trace (plan → tool calls → validation); observability rating is evidence-backed.
- **Artifact:** post on observability vs. evals — "you can see failures or prevent them; you need both."

**Phase 2 milestone:** package the assessment flow (run evals → generate scorecard → review architecture/guardrail/observability gaps) as a documented, repeatable **"Production-Readiness Assessment"** workflow in `/docs`.

---

## Phase 3 — Governance & security overlay (Weeks 17–24)

**Objective:** Add the compliance/governance layer and complete the scorecard's governance dimensions.

### Phase 3A — OWASP Agentic Top 10 mapping (Weeks 17–18)
- **First task: verify the current OWASP agentic taxonomy and identifiers at build time** (the project's naming and item set have shifted over time — earlier OWASP agentic-threat work used T1–T15; cite the exact version mapped).
- `governance/owasp/` maps each item of the then-current taxonomy to a concrete check or guardrail in the stack (machine-readable + human-readable).
- Scorecard *Guardrail coverage* dimension now computed against this mapping.
- **Acceptance:** the mapping cites the exact OWASP version/identifiers; each item is either covered (with the mechanism named) or explicitly flagged as a gap. No silent omissions.
- **Artifact:** post mapping the OWASP agentic threat list to a real mid-market stack.

### Phase 3B — NIST AI RMF mapping (Weeks 19–20)
- `governance/nist/` maps stack capabilities to the relevant NIST AI RMF functions (Govern/Map/Measure/Manage).
- **Acceptance:** the mapping is honest about what the stack does and doesn't cover; framed for a procurement reviewer.
- **Artifact:** post on NIST AI RMF "without the 100-page slog" for mid-market.

### Phase 3C — EU AI Act deployer readout (Weeks 21–22)
- **First task: re-verify every date, obligation, and penalty tier against the law as it stands at build time** — these were checked months before this phase executes, and the Digital Omnibus status will have moved. As of this PRD's writing:
  - **2 Aug 2026** → Article 50 transparency obligations for deployers.
  - **2 Dec 2026** → synthetic-content watermarking/machine-readability (Art. 50(2)).
  - **2 Dec 2027** → heaviest high-risk (Annex III) obligations incl. fundamental-rights impact assessments and most deployer duties — *deferred by the Digital Omnibus, which is agreed but takes legal effect only on Official Journal publication.*
  - Penalty tiers: **€35M / 7%** = Article 5 prohibited practices; **€15M / 3%** = high-risk non-compliance. Do not conflate.
- `governance/eu-ai-act/` produces a precise *deployer* readout. **Get the framing right** (this is the credibility test).
- Scorecard *Governance readiness* dimension computed from this module.
- **Acceptance:** dates/penalties re-verified at build time; the readout distinguishes what applies *now* from what's deferred, and flags the current legal status of the Omnibus. A mid-market CTO could act on it without a lawyer for the basics.
- **Artifact:** post — "What the EU AI Act actually requires of you in 2026 vs. 2027 (most advice gets this wrong)."

### Phase 3D — Sovereign / on-prem variant (Weeks 23–24)
- Document and demonstrate an **air-gapped variant** running the reference agent fully on Ollama (M4 Mac Studio), with the eval harness and scorecard intact. (The 1A judge-portability requirement means no eval metric depends on a cloud judge; the 2C gateway runs locally in front of Ollama.)
- **Acceptance:** the full pipeline (agent → evals → scorecard) runs with no cloud dependency; the cost/effort trade-off is documented honestly using the 1B Ollama cost semantics (self-hosting carries materially more engineering effort and only pencils out above meaningful token volume — present as directional, not a guarantee).
- **Artifact:** post on the regulated/sovereign mid-market variant.

**Phase 3 gate:** the full scorecard (all five dimensions) now produces an end-to-end, evidence-backed readout. This is the complete reference stack.

---

## Beyond Week 24 (ongoing, not in this PRD's detailed scope)

- Recurring content series (MCP security as CVEs surface; benchmarking on mid-market-relevant tasks; FinOps/cost pillar).
- A vertical extension *only if* a specific industry need pulls toward it — additive, never a replacement for the reliability flag.

---

## Global definition of done

A phase ships only when all of the following hold:
1. Acceptance criteria for every sub-phase are checked.
2. `bun run reliability` reflects the new capability and the full suite passes CI.
3. The build-in-public artifact for each cycle exists in `/content` and has been (or is scheduled to be) posted.
4. Any stack deviation is recorded as an ADR in `/docs/decisions/`.
5. Every "must never" is enforced by a mechanism (hook / schema / CI gate), not a comment or instruction.

## Explicit non-goals

- Competing in the developer/PM evals tooling space (out of scope).
- A standalone AI-readiness/governance self-assessment tool (governance is a *layer* here, not the headline).
- A broad, general-purpose framework. Narrow and opinionated wins.
- A product to support. This is a reference implementation, not supported software.

## Open items to confirm before external publication

- Exact final SMC thresholds and adoption date once the Digital Omnibus is published in the Official Journal.
- Whether any eval metric forces the language escape hatch — default stays TS-only (promptfoo); record an ADR after Phase 1A only if a named metric proves genuinely unavailable.
- Public repo name (see pre-flight in the build plan) — it is the brand in the launch post.
