# Build Plan — Grade Stack (Mid-Market Agentic AI Reliability & Governance Reference Stack)

**Owner:** Clarke Bishop · **Status:** v1 execution plan · **Source of truth:** [`docs/PRD-Grade-Stack.md`](./PRD-Grade-Stack.md)

This is the step-by-step build runbook that turns the PRD's phases into ordered, executable tasks. The PRD defines *what* and the *contract* (acceptance criteria); this plan defines *how* and *in what order*. Read them side-by-side — the section numbering here mirrors the PRD's phase spine.

> **Filename note:** The PRD's "How to use" section references a working filename `PRD-Mid-Market-Reliability-Stack.md`. The file on disk is `docs/PRD-Grade-Stack.md`. Use the on-disk path everywhere.

---

## How to use this plan

- **Work one sub-phase at a time.** Each lettered sub-phase (0, 1A, 1B, …) is a ~2-week increment. Do **not** pull scope forward from a later phase.
- **The acceptance criteria are the contract.** A sub-phase is "done" only when every checkbox is checked **and** the build-in-public artifact for that cycle exists in `/content/cycle-XX/`.
- **Enforce with mechanisms, not prose.** Where the PRD says "must never," implement a hook, schema, or CI gate — never a `CLAUDE.md` instruction. This is a product design principle, not just a build convention.
- **Record every deviation as an ADR** in `docs/decisions/`. No silent stack changes.
- **Kickoff prompt per sub-phase** (adapt the bracket):
  > *"Read `docs/PRD-Grade-Stack.md`, `docs/PLAN-Grade-stack.md`, and `CLAUDE.md`. We are starting Phase [X.Y]. List the concrete tasks from the plan, propose a branch name, and implement only that sub-phase. Stop at its acceptance criteria."*

---

## Conventions & global rules (apply to every phase)

**Stack (non-negotiable unless overridden by an ADR):**

| Layer | Choice |
|---|---|
| Runtime / package manager | **Bun** only — no npm/yarn/pnpm mixing |
| Language | **TypeScript**, `strict: true`, no implicit `any` |
| CLI framework | **Commander** — single `reliability` binary, subcommands per capability |
| Primary eval engine | **promptfoo** (config-as-code, CI-friendly) |
| Tracing | **OpenTelemetry** (GenAI semantic conventions) |
| Tool/integration layer | **MCP** (TypeScript SDK) |
| Models — cloud | **Amazon Bedrock** (Claude) — production path |
| Models — local | **Ollama** on M4 Mac Studio — dev/variant path |
| Guardrails | provider-agnostic **LLM gateway**, server-side enforcement |
| Agent pattern | **Planner / Executor / Validator** |

> **Package-manager note:** This project mandates **Bun** (per PRD). That overrides the global default of pnpm — do not switch this project to pnpm.

**Hard constraints (carry into every sub-phase):**
- **Time budget:** ~32 hrs/week, sequenced — no parallel phases.
- **OSS scope discipline:** repo stays narrow and opinionated. If maintenance burden grows, cut repo scope — never cut publishing cadence.
- **Mid-market legibility:** every artifact must be explainable to a non-ML-platform team and a non-technical executive. If it can't be explained to a board, it's mis-scoped.
- **No secrets in the repo.** Inject via env; a pre-commit hook must block committed secrets.

**Language escape hatch (only sanctioned path to non-TS code), in order of preference:**
1. **Isolated scorer (preferred):** a specific named eval metric genuinely unavailable in promptfoo → one Python scorer behind a subprocess/HTTP/OTel boundary. A leaf, not a layer.
2. **Clean-seam split (only if a whole layer earns it):** realistically only the eval/scoring package, behind a real protocol boundary. The MCP server stays TS regardless.
- Any move under this section is an **ADR** in `docs/decisions/`. Default stays TS-only.

**Cadence model:**
- **Bi-weekly phase gate** — each sub-phase ends in a shippable, narratable deliverable.
- **Two posts per sub-phase:** a mid-cycle ("working on / what surprised me") and an end-of-cycle ("shipped / here's the artifact"). Drafts in `content/cycle-XX/`.
- **Posting split:** ~80% practice-in-public (LinkedIn narrative), ~15% technical artifact (repo/commits), ~5% transparency (phase-boundary retrospective).
- **Definition of "narratable":** if you can't write the end-of-cycle post from the increment, the increment isn't done.

**Commit hygiene:** standard commit messages, **no AI-tool attribution** (per global convention).

**Global definition of done (every phase must clear all five):**
1. Acceptance criteria for every sub-phase are checked.
2. `bun run reliability` reflects the new capability and the full suite passes CI.
3. The build-in-public artifact for each cycle exists in `/content` and has been (or is scheduled to be) posted.
4. Any stack deviation is recorded as an ADR in `docs/decisions/`.
5. Every "must never" is enforced by a mechanism (hook / schema / CI gate), not a comment.

---

## Pre-flight (one-time, before Phase 0 tasks)

These unblock the hooks, eval-gate, and CI that later phases assume.

- [ ] Confirm **Bun** is installed (`bun --version`); install if absent.
- [ ] **`git init`** — the repo is not yet under version control, and the secret-scan hook, eval-gate, and GitHub Actions CI all assume git. (A `.gitignore` is already present — node_modules, `.env*`, build output, `docs/internal/`, `.DS_Store`.)
- [ ] **Activate the repo's git hooks:** `git config core.hooksPath .githooks`. This turns on the tracked `pre-commit` guard that blocks committing anything under `docs/internal/` (the internal-only strategy docs) — belt-and-suspenders alongside `.gitignore`.
- [ ] Decide the **GitHub remote** and confirm **public** visibility (PRD requires a public repo). Create it but keep the first push for the end of Phase 0.
- [ ] Confirm local model access: **Bedrock** credentials available via env (AWS profile / keys, region with Claude access) and **Ollama** running with at least one pulled model (e.g. `qwen3.5`, `deepseek-r1`, or `llama3.3`).
- [ ] Decide the single **reference-agent task** to commit to for the whole build — recommended: *"triage an inbound support email and draft a structured response."* Everything downstream evaluates this one task.

---

## Phase 0 — Foundation & flag-planting (Weeks 1–2)

**Objective:** Stand up the repo and publicly declare the point of view. Establish the spine before any feature. **Out of scope:** any evals, tracing, MCP, gateway, governance — resist all of it.

**Branch:** `phase-0-foundation`

**Tasks (ordered):**
1. **Init Bun workspace + monorepo layout.** Create the target structure with README stubs in each package:
   ```
   packages/{cli,core,evals,mcp-server,gateway,scorecard}/
   reference-agent/
   governance/
   content/cycle-00/
   docs/decisions/
   .claude/{commands,settings.json}
   ```
2. **Root config:** root `package.json` with Bun workspaces; **strict `tsconfig.json`** (`strict: true`, no implicit `any`); lint + format config (Biome or ESLint+Prettier — record the choice as an ADR if it deviates from any stated default). Add Bun scripts including `reliability` → CLI entrypoint.
3. **Commander CLI entrypoint** in `packages/cli` so `bun run reliability --help` works and prints subcommand scaffolding.
4. **Provider abstraction** in `packages/core`: a single interface the reference agent calls, with **Bedrock** and **Ollama** implementations selectable via flag/env (e.g. `--provider bedrock|ollama` or `RELIABILITY_PROVIDER`). No reliability tooling — just model invocation.
5. **Naive reference agent** in `reference-agent/`: implements the one chosen task end-to-end against **both** providers. Intentionally naive — this is the documented "before" state.
6. **`CLAUDE.md`** at repo root: build conventions + the "mechanisms not prose" principle.
7. **`.claude/settings.json`:**
   - **PreToolUse / pre-commit secret-scan hook** that blocks committed secrets. Verify it fires on a deliberately planted test secret.
   - **Placeholder eval-gate hook** (no-op now; wired for real in Phase 1B).
8. **README** with the POV statement, committed verbatim:
   > *"I help mid-market companies ship AI agents that are reliable, observable, and governed — the enterprise-grade version, right-sized for a company without an ML platform team."*
9. **Content — `content/cycle-00/`:** launch post — *"I'm building the open reference stack for getting mid-market AI agents to production, in public — here's the repo and why."* (plus the mid-cycle "what I'm setting up" post).
10. Make the repo public; push.

**Acceptance criteria (PRD contract):**
- [ ] `bun install && bun run reliability --help` works from a clean clone.
- [ ] Reference agent completes its one task against **both** Bedrock and Ollama.
- [ ] Secret-scan hook blocks a deliberately planted test secret.
- [ ] Repo is public; README states the POV.
- [ ] **Artifact:** launch post in `content/cycle-00/`.

---

## Phase 1 — Eval/reliability harness MVP (Weeks 3–8)

The highest-leverage phase — the foundation everything else builds on.

### Phase 1A — Core eval harness (Weeks 3–4)

**Objective:** Make the naive reference agent *measurable*. **Branch:** `phase-1a-eval-harness`

**Tasks (ordered):**
1. `packages/evals`: **promptfoo config-as-code** targeting the reference agent (via the CLI/core provider abstraction, not a forked code path).
2. **Starter suite — ≥10 cases** spanning the real input distribution, **including at least one refusal / empty / out-of-distribution case** (to surface mode-collapse-style failures) and cases structurally identical to production inputs.
3. **Trace-level scoring:** each eval records per-step outcomes along the planner/executor/validator path, not just final pass/fail. (The agent is still naive here; capture whatever step structure exists, and design the schema so it survives the Phase 2A refactor.)
4. **`reliability eval run`** subcommand: executes the suite, emits **structured JSON** results.
5. **Reproducibility:** seed / pin determinism where the provider allows; document what is and isn't deterministic.
6. **ADR checkpoint:** only if a named metric proves genuinely unavailable in promptfoo, record an ADR before reaching for the Python escape hatch. Otherwise stay TS-only.

**Acceptance criteria:**
- [ ] `reliability eval run` executes the suite and emits structured JSON results.
- [ ] Suite includes ≥1 null/refusal case and cases structurally identical to production inputs.
- [ ] Results reproducible across two runs (seeded/deterministic where possible).
- [ ] **Artifact:** post — *"the cheapest reliability win is making your agent measurable — here's a 10-case harness."* (in `content/cycle-01/`).

### Phase 1B — CI gating + cost-per-success (Weeks 5–6)

**Objective:** Turn evals into an enforcement mechanism and introduce the executive-legible unit metric. **Branch:** `phase-1b-ci-gate-cost`

**Tasks (ordered):**
1. **GitHub Actions workflow** running the eval suite on PRs.
2. **Wire the eval-gate hook for real** — it now **fails the build on regression** (programmatic enforcement, not advisory). Define the threshold and the baseline-comparison mechanism.
3. **Cost-per-success** as a first-class metric: token + dollar cost per *passing* outcome (not per call). Surface in JSON results **and** CLI output. (Capture per-provider pricing in config so the dollar figure is real.)
4. **`--max-turns` / loop-bounding** on the reference agent; the bound is **enforced**, not suggested.

**Acceptance criteria:**
- [ ] A PR that degrades agent quality below threshold is **blocked by CI automatically**.
- [ ] `reliability eval run` reports cost-per-success per scenario.
- [ ] Runaway loops are bounded and the bound is enforced, not suggested.
- [ ] **Artifact:** post — *"cost-per-success is the metric your board actually understands — why cost-per-call lies."* (in `content/cycle-02/`).

### Phase 1C — AI Reliability Scorecard v1 (Weeks 7–8) · *the executive-facing deliverable*

**Objective:** Translate eval results into a board-legible trust/risk readout. The single most executive-facing artifact. **Branch:** `phase-1c-scorecard`

**Tasks (ordered):**
1. `packages/scorecard`: generate a one-page **AI Reliability Scorecard** from eval results, with executive dimensions — **Reliability**, **Cost discipline**, **Observability coverage**, **Guardrail coverage**, **Governance readiness**. The last two are **stubbed** (clearly marked "not yet assessed") until Phases 2D/3.
2. Each dimension gets a **plain-language rating + the evidence behind it** (traced to eval results — no unsupported scores).
3. **Output:** Markdown **and** clean printable HTML; no jargon a CFO wouldn't understand.
4. **`reliability scorecard`** subcommand.
5. **Honest degradation:** verify a deliberately worsened agent produces a worse scorecard.

**Acceptance criteria:**
- [ ] Running the scorecard against the reference agent produces a one-page readout an executive could read in 3 minutes.
- [ ] Every rating traces to underlying eval evidence (no unsupported scores).
- [ ] Ratings degrade honestly (a worse agent → a worse scorecard).
- [ ] **Artifact:** publish a sample scorecard + post — *"How a board can tell if its AI agent is trustworthy — without reading a single trace."* (the flagship public artifact; in `content/cycle-03/`).

> **Phase 1 gate:** Do not proceed to Phase 2 until the scorecard is published. *If the executive narrative isn't landing after ~8 weeks of consistent posting, the framing is too technical — refine the scorecard/narrative for the executive reader before adding any architecture scope.*

---

## Phase 2 — Reference architecture + MCP integration (Weeks 9–16)

**Objective:** Promote the naive agent into a credible, vendor-neutral reference architecture, and add the integration layer.

### Phase 2A — Planner/Executor/Validator pattern (Weeks 9–10)

**Branch:** `phase-2a-pev`
1. Refactor the reference agent into an explicit **planner → executor → validator** structure in `packages/core`.
2. The **validator uses structured output** (tool-use / schema-enforced via Zod→tool-schema), **not prompted JSON**. This is an enforcement mechanism — the schema is the contract.
3. Document the pattern as a **reusable blueprint** in `docs/`.
4. Verify the Phase 1A trace-level scoring still maps onto the now-explicit steps.

**Acceptance:**
- [ ] The pattern is documented as a reusable blueprint.
- [ ] Eval scores **hold or improve** through the refactor.
- [ ] **Artifact:** post on the planner/executor/validator pattern as the mid-market default (`content/cycle-04/`).

### Phase 2B — MCP integration layer (Weeks 11–12)

**Branch:** `phase-2b-mcp`
1. `packages/mcp-server`: expose **at least one tool and one resource**, correctly distinguished (model-controlled action vs. app-exposed data).
2. The reference agent **consumes** the MCP server.
3. Ensure **tool descriptions** (not names or prompt rules) drive selection.
4. Document **transports**: stdio (local) and HTTP (remote).

**Acceptance:**
- [ ] Tool-vs-resource choice is defensible per the control model.
- [ ] Tool descriptions drive selection; transports documented.
- [ ] **Artifact:** post — *"the tool-vs-resource mistake every team makes with MCP."* (`content/cycle-05/`).

### Phase 2C — LLM gateway / guardrails (Weeks 13–14)

**Branch:** `phase-2c-gateway`
1. `packages/gateway`: sits between agent and models, enforcing policy **server-side** — input/output filters, PII handling, allow/deny.
2. **Prove server-side enforcement:** a guardrail violation is blocked at the gateway **even when the agent prompt is manipulated to bypass it** (this is the acceptance test, not a nice-to-have).

**Acceptance:**
- [ ] A guardrail violation is blocked at the gateway even under a bypass-attempt prompt.
- [ ] **Artifact:** post on why guardrails belong in the gateway, not the prompt (`content/cycle-06/`).

### Phase 2D — OpenTelemetry tracing (Weeks 15–16)

**Branch:** `phase-2d-otel`
1. Instrument the full path with **OTel GenAI semantic conventions**; export to an OTLP backend (Phoenix or similar) for viewing.
2. The scorecard's **Observability coverage** dimension is now **computed from real trace coverage** (un-stub it).
3. Verify a full run yields a **connected trace**: plan → tool calls → validation.

**Acceptance:**
- [ ] A full agent run produces a connected trace (plan → tool calls → validation).
- [ ] Observability rating is evidence-backed.
- [ ] **Artifact:** post on observability vs. evals — *"you can see failures or prevent them; you need both."* (`content/cycle-07/`).

> **Phase 2 milestone:** Package the assessment flow (run evals → generate scorecard → review architecture/guardrail/observability gaps) as a documented, repeatable **"Production-Readiness Assessment"** workflow in `docs/`.

---

## Phase 3 — Governance & security overlay (Weeks 17–24)

**Objective:** Add the compliance/governance layer and complete the scorecard's governance dimensions.

### Phase 3A — OWASP Agentic Top 10 mapping (Weeks 17–18)

**Branch:** `phase-3a-owasp`
1. `governance/owasp/`: map each **ASI01–ASI10** risk to a concrete check or guardrail in the stack — **machine-readable + human-readable**.
2. The scorecard's **Guardrail coverage** dimension is now **computed against this mapping** (un-stub it).
3. **No silent omissions:** each item is either covered (mechanism named) or explicitly flagged as a gap.

**Acceptance:**
- [ ] Each OWASP item is covered (with mechanism named) or explicitly flagged as a gap.
- [ ] **Artifact:** post mapping the OWASP Agentic Top 10 to a real mid-market stack (`content/cycle-08/`).

### Phase 3B — NIST AI RMF mapping (Weeks 19–20)

**Branch:** `phase-3b-nist`
1. `governance/nist/`: map stack capabilities to the relevant NIST AI RMF functions (**Govern / Map / Measure / Manage**).
2. Be **honest** about what the stack does and doesn't cover; frame for a **procurement reviewer**.

**Acceptance:**
- [ ] The mapping is honest about coverage gaps; framed for procurement.
- [ ] **Artifact:** post — *"NIST AI RMF without the 100-page slog"* for mid-market (`content/cycle-09/`).

### Phase 3C — EU AI Act deployer readout (Weeks 21–22)

**Branch:** `phase-3c-eu-ai-act`
1. `governance/eu-ai-act/`: produce a precise **deployer** readout. Get the framing exactly right (this is the credibility test):
   - **2 Aug 2026** → Article 50 transparency obligations for deployers.
   - **2 Dec 2026** → synthetic-content watermarking / machine-readability (Art. 50(2)).
   - **2 Dec 2027** → heaviest high-risk (Annex III) obligations incl. fundamental-rights impact assessments and most deployer duties — *deferred by the Digital Omnibus, which is agreed but takes legal effect only on Official Journal publication.*
   - Penalty tiers: **€35M / 7%** = Article 5 prohibited practices; **€15M / 3%** = high-risk non-compliance. **Do not conflate.**
2. The readout must **distinguish what applies now from what's deferred**, and flag that the Omnibus is **not yet law**.
3. The scorecard's **Governance readiness** dimension is now **computed from this module** (un-stub the last dimension).

**Acceptance:**
- [ ] The readout distinguishes current vs. deferred obligations and flags that the Omnibus is not yet law.
- [ ] A mid-market CTO could act on the basics without a lawyer.
- [ ] **Artifact:** post — *"What the EU AI Act actually requires of you in 2026 vs. 2027 (most advice gets this wrong)."* (`content/cycle-10/`).

### Phase 3D — Sovereign / on-prem variant (Weeks 23–24)

**Branch:** `phase-3d-sovereign`
1. Document and demonstrate an **air-gapped variant** running the reference agent fully on **Ollama** (M4 Mac Studio), with the eval harness and scorecard intact.
2. **Prove zero cloud dependency:** the full pipeline (agent → evals → scorecard) runs with networking disabled.
3. Document the cost/effort trade-off **honestly** — self-hosting carries materially more engineering effort and only pencils out above meaningful token volume; present as **directional, not a guarantee**.

**Acceptance:**
- [ ] The full pipeline runs with no cloud dependency.
- [ ] The cost/effort trade-off is documented honestly (directional).
- [ ] **Artifact:** post on the regulated/sovereign mid-market variant (`content/cycle-11/`).

> **Phase 3 gate:** the full scorecard (all five dimensions) now produces an end-to-end, evidence-backed readout. This is the complete reference stack.

---

## Cross-cutting tracks (do not drop between phases)

### Enforcement-mechanism register

Maintain a running table in `docs/` mapping every "must never" to the mechanism that enforces it. Target entries by the end of the build:

| Rule | Mechanism | Introduced |
|---|---|---|
| No secrets in repo | PreToolUse/pre-commit secret-scan hook | Phase 0 |
| No quality regression merged | Eval-gate hook + GitHub Actions CI | Phase 1B |
| No runaway agent loops | `--max-turns` bound, enforced | Phase 1B |
| Validator output must conform | Zod→tool-schema structured output | Phase 2A |
| Guardrails can't be prompt-bypassed | Server-side gateway enforcement | Phase 2C |
| No silent governance omissions | OWASP coverage check (covered-or-flagged) | Phase 3A |

### ADR log (`docs/decisions/`)

Record an ADR at any of these decision points: lint/format tooling choice (Phase 0); any Python escape-hatch use (Phase 1A onward); eval threshold/baseline strategy (1B); MCP transport decisions (2B); gateway policy model (2C); OTLP backend choice (2D). Default everywhere is the PRD's stated stack — ADR only on deviation.

### Content cadence checklist (per cycle)

For each `content/cycle-XX/`: a **mid-cycle** "working on / what surprised me" post and an **end-of-cycle** "shipped / here's the artifact" post. Maintain the ~80/15/5 split, and write a short **transparency retrospective** at each phase boundary (0→1, 1→2, 2→3).

### Open items to confirm before external publication (from PRD)

- Exact final SMC thresholds and adoption date once the Digital Omnibus is published in the Official Journal.
- Whether any eval metric forces the language escape hatch — default stays TS-only (promptfoo); record an ADR after Phase 1A only if a named metric proves genuinely unavailable.

---

## Verification (how to confirm each phase is real, not asserted)

Run these from a clean clone at each phase boundary:

- **Phase 0:** `bun install && bun run reliability --help`; run the reference agent against Bedrock and Ollama; attempt to commit a planted test secret → blocked by the hook; repo is public with POV in README.
- **Phase 1A:** `reliability eval run` → structured JSON with ≥10 cases incl. a refusal/OOD case; run twice → reproducible.
- **Phase 1B:** open a PR that worsens the agent → CI blocks it; `reliability eval run` output shows cost-per-success per scenario; confirm the loop bound triggers.
- **Phase 1C:** `reliability scorecard` → one-page Markdown + HTML readout; worsen the agent → scorecard ratings drop; every rating cites eval evidence.
- **Phase 2A:** eval scores hold/improve post-refactor; validator output rejects a schema-violating response.
- **Phase 2B:** agent selects the MCP tool from its description; tool and resource are distinct; stdio + HTTP transports both work.
- **Phase 2C:** craft a prompt that tries to bypass a guardrail → still blocked at the gateway.
- **Phase 2D:** a full run produces a connected trace in the OTLP backend; scorecard Observability rating is trace-derived.
- **Phase 3A–C:** OWASP/NIST/EU mappings have no silent gaps; scorecard Guardrail coverage and Governance readiness are now computed, not stubbed.
- **Phase 3D:** disable networking → full agent → evals → scorecard pipeline still completes on Ollama.

**Final gate — Global Definition of Done:** all sub-phase criteria checked; `bun run reliability` reflects every capability and the full suite passes CI; every cycle's artifact exists in `/content`; every deviation has an ADR; every "must never" is enforced by a mechanism.
