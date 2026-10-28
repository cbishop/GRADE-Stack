# Gap analysis: grade-stack against the four-pillar assurance loop

Status: written 2026-10-28 at commit `e5882b1`. Read-only audit. It proposes work and does not record decisions. Paths are relative to the repo root; line numbers are as of that commit.

## Change Reason
2026-10-28 The field continues to evolve, and improvements have been identified.

## The model being measured against

Salim Ismail (OpenExO; *The Organizational Singularity*, public working draft v25, June 2026, https://openexo.com/organizational-singularity; Moonshots EP #305, 2026-10-23, https://www.youtube.com/watch?v=LeSIe50WfLI&t=3133s) says every agent needs a governance and assurance loop with four parts: trusted evaluation suites, full traceability and logging, rollback capability, and a human review queue. As autonomy rises he adds explicit mandates and boundaries: what an agent can spend, what terms it can accept, and when it must ask. The draft turns this into a deploy gate: score each pillar 1 to 5, and deploy no new agent class below 3 on all four. The four pillars map closely to OpenAI's 2023 "Practices for Governing Agentic AI Systems" (interruptibility, legibility, human approval) and NIST AI RMF 1.0 MANAGE 2.4 (mechanisms to supersede, disengage, or deactivate AI systems), so they are a reasonable external yardstick.

A framing note. The CLI binary is `reliability` and the code calls its deliverable the "AI Reliability Scorecard". Its five scored dimensions are Reliability, Cost discipline, Observability coverage, Guardrail coverage, and Governance readiness (`packages/scorecard/src/scorecard.ts:447-475`). They do not line up with the GRADE letters in the README (Governed, Reliable, Agentic, Deployed, Evaluated), so each section below names both the code dimension and the GRADE letter it would belong to.

## Summary

| # | Component | Code status | Scorecard status | Gap | Smallest addition |
|---|---|---|---|---|---|
| 1 | Trusted evaluation suites | Partial. 12-case suite, LLM judge, regression gate, CI. Strong before deployment, nothing after | Partial. Reliability grades pass rate | CI gate runs only on the stub provider. Judge never calibrated against human labels. No post-deployment eval | An eval record (suite, baseline, last real-model run, judge-vs-human agreement on about 20 cases), a post-deployment cadence criterion, and `reliability eval run --from-traces` |
| 2 | Traceability and logging | Partial. One connected OTel trace per run, but opt-in, content-free, identity-free; the gateway logs nothing | Partial. Observability grades "connected", not "attributable" or "reconstructable" | No actor or request id on spans. No prompts or outputs. Gateway allow, block, redact and route decisions never recorded. No retention. EU AI Act mapping rates logging "supported" | Append-only gateway decision log (JSONL, about 40 lines) plus `enduser.id` and request id span attributes; downgrade EU AI Act Art 12 / 26(6) to partial |
| 3 | Rollback | Missing. No kill switch (OWASP ASI10 residual admits it), no version manifest | Not graded | Eval results stamp only provider, model and timestamp, so there is no prior version to revert to | Gateway kill switch (`RELIABILITY_HALT`, about 30 lines) plus a release manifest (git SHA, prompt hash, model, tools) on eval results and spans |
| 4 | Human review queue | Missing. Router escalates low confidence to a bigger model, never to a person; no approver record | Not graded. Governance JSON claims human-in-the-loop with no code behind it | EU AI Act Art 26 oversight rated "supported" on "human-reviewed drafts" | Review queue fed by router confidence, max-turn failures and redactions, with `reliability review list / approve / reject --as <name>` (about 120 lines); downgrade Art 26 to partial now |
| 5 | Boundaries and protocols | Partial. Strong single-agent containment; no per-tool scopes, no autonomy levels, no caller identity, no agent-to-agent protocol | Not graded. README promises "A · Agentic"; no dimension computes it | Policy is global; the gateway accepts any POST | Per-agent policy manifest (autonomy level L0 to L3, allowed tools and models, max turns) enforced at the gateway, plus a real Agentic dimension |

Bottom line: grade-stack partly covers evals, traceability and boundaries, and has no code for rollback or a human review queue. Two governance mapping entries currently rate oversight and logging "supported" without mechanisms behind them, which breaks the repo's own "mechanisms, not prose" rule and should be fixed first.

---

## 1. Trusted evaluation suites: Partial

### What the code does
- **The suite.** `packages/evals/promptfooconfig.yaml` holds 12 support-email cases: billing, technical, account, mixed, positive, empty-body, out-of-distribution, data-exfiltration refusal, and terse-urgent. Default assertions (lines 38-73) check response, JSON validity, fields, enums, and an `llm-rubric` judge metric (`validate:judge`, line 72). Each case adds its own category and sentiment checks (lines 83-235).
- **Trace-level scoring.** Each case scores plan, execute and validate separately (`packages/core/src/pev.ts:36-43`; `content/cycle-12/interaction.md:11-24`).
- **Stability.** `--repeat N` folds repeats into a per-case stability score (`packages/evals/src/run.ts:99-101`). The scorecard holds Reliability back one band when results are flaky (`packages/scorecard/src/scorecard.ts:103-123`).
- **The gate.** `evaluateGate` compares pass rate to a committed baseline within a one-case band (line 75) and enforces an optional USD cost cap (line 90), in `packages/evals/src/gate.ts:59-97`. Tests at `packages/evals/src/gate.test.ts:45-88`, including degraded mode collapsing to 0/12 and being blocked.
- **CI enforcement.** `.github/workflows/ci.yml:32-59` runs the full suite on push to main and a 6-case smoke suite on PRs. Fork PRs run evals only after a maintainer applies `eval-approved` (ADR 0004).
- **Degraded-mode canary.** A permanent deliberate regression proves the gate bites (`reference-agent/src/agent.ts:122-139`).
- **Judge portability.** The judge can run on a different provider from the agent (`-J`, `packages/evals/README.md`).

### What is missing
- **The CI gate never touches a real model.** It runs `--provider stub` (`ci.yml:56,59`) against `packages/evals/baseline.stub.json` (12/12, $0). It proves the harness and code path, not model quality. ADR 0003 records the choice; the real-Bedrock job on main promised in `gate.ts:15-16` does not exist in `ci.yml`.
- **No post-deployment evaluation.** Nothing samples production traffic, re-scores captured traces, or watches for drift. "Before and after deployment" is half met.
- **The judge is never calibrated against human labels**, so there is no basis to trust it.
- **12 synthetic cases**, with no workflow for turning real incidents into cases.
- The local Claude Code `Stop` eval-gate hook is still a no-op (`.claude/hooks/eval-gate.sh:5-11`, `exit 0`), though CLAUDE.md says it would be wired in Phase 1B.

### Scorecard
- GRADE letter **E · Evaluated**. Code dimension **Reliability** (bands at `scorecard.ts:74-78`: 90% Strong, 75% Adequate, 50% At risk), plus **Cost discipline** (waste fraction, `scorecard.ts:135-190`).
- The assessment methodology names no evidence artifact for evals; the scorecard itself carries the result.

### Smallest credible additions
1. **Eval record artifact:** suite definition, baseline, last real-model run with date and model, judge-vs-human agreement on about 20 hand-labeled cases. No code needed.
2. **Scorecard criterion:** evals re-run on a schedule and on every model, prompt or tool change; a production sample re-scored at least monthly.
3. **Code (later):** `reliability eval run --from-traces <file>` to re-score captured production runs.

---

## 2. Full traceability and logging: Partial

### What the code does
- **OTel seam** in `packages/core/src/tracing.ts`: GenAI semantic-convention keys (67-78); `withSpan` with status and exceptions (132-158); `traceProvider` wrapping every model call as a `chat` span with model and token usage (167-198); opt-in OTLP export, Phoenix by default (235-267); a hermetic coverage calculator (316-342).
- **One connected trace per run.** Root span `agent.run` at `reference-agent/src/agent.ts:231-236`; phase spans with attempt numbers at `packages/core/src/pev.ts:141-181`; MCP grounding and `execute_tool` spans at `reference-agent/src/mcp.ts:193-211`.
- **Tests:** `packages/core/src/tracing.test.ts:39-178`, `reference-agent/src/trace.test.ts:20-60`.
- **In-process step log.** `PEVResult.steps` (`pev.ts:98-112`) records every attempt, including validator rejection reasons.
- **CLI:** `reliability agent run --trace` prints the span tree (`packages/cli/src/index.ts:90,122`). Docs: `docs/observability-tracing.md`, ADR 0008.

### What is missing
- **Not attributable.** No span carries a user, caller, session or request id; a grep for `enduser`, `user.id`, `session` and `actor` across `packages/*/src` and `reference-agent/src` finds nothing.
- **Not reconstructable.** Spans carry token counts and model ids but no prompt, output, or tool arguments and results (`tracing.ts:172-193`).
- **Off by default.** Export activates only with `RELIABILITY_OTEL=1` or an OTLP endpoint (`tracing.ts:56-60, 203-209`).
- **The gateway is a blind spot.** `GatewayService.generate` (`packages/gateway/src/gateway.ts:77-105`) returns violations, redactions and routing decisions but never logs, persists or traces them. The HTTP adapter (`packages/gateway/src/connect.ts:71-74`) maps them to 422 or 200 and moves on. Blocked injections, exfiltration attempts, PII redactions and frontier escalations leave no record.
- **No retention, integrity or tamper evidence.**
- **The scorecard measures the reference agent driven by the stub** (`packages/cli/src/index.ts:658-661`), not a deployed system.
- **Overclaim.** `governance/eu-ai-act/eu-ai-act-deployer-2026.json:122-140` rates Art 26(6) / Art 12 logging "supported", calls the traces "durable", and says "Strongest area of stack readiness". NIST MEASURE 3 and MANAGE 4 make similar claims (`governance/nist/nist-ai-rmf-1.0-mapping.json:183-195, 253-265`).

### Scorecard
- GRADE letter **D · Deployed**. Code dimension **Observability coverage** (`scorecard.ts:208-262`) grades whether the trace is connected and all three phases appear, not attribution, content capture or retention.
- The assessment methodology names a change log for models, prompts and tools (configuration history, not action history) and no logging and retention artifact.

### Smallest credible additions
1. **Code:** append-only `gateway-decisions.jsonl`, one line per request: ISO time, request id, caller id, target, policy fired, allow / block / redact, servedBy, escalated, confidence, SHA-256 of input and output. Roughly 40 lines plus a test in `gateway.ts`. Add `enduser.id` and `grade_stack.request_id` span attributes, and an opt-in `RELIABILITY_TRACE_CONTENT=1` recording prompt and output on `chat` spans.
2. **Scorecard criterion:** Observability gains "attributable" and "reconstructable (inputs and outputs retained N days)" beside "connected".
3. **Logging and retention record:** what is logged, where, for how long, who can read it, plus one reconstructed sample run.

---

## 3. Rollback capability: Missing

### What the code does (adjacent controls only)
- **Pre-merge regression block.** The CI eval gate stops a bad change shipping (`ci.yml:32-59`); re-baselining needs "an explicit, reviewed re-baseline commit" (ADR 0003 line 43). Prevention, not rollback.
- **Model pinning.** `RELIABILITY_BEDROCK_MODEL` / `RELIABILITY_OLLAMA_MODEL` (README), plus an opt-in model allowlist (`packages/gateway/src/policy.ts:20-35, 161-169`).
- **Nothing to undo, by design.** MCP tools are read-only lookups (`packages/mcp-server/src/server.ts:64-128`; OWASP ASI02 residual, json:60) and the agent only drafts text. Honest for the reference architecture, but it proves nothing about rollback.
- **Turn bound.** `MaxTurnsError` (`pev.ts:45-63`) stops a runaway loop inside one run; it is not a deployment kill switch.

### What is missing
- **No kill switch.** OWASP ASI10 residual: "there is no runtime anomaly detector or kill-switch for emergent behavior in production" (`governance/owasp/owasp-agentic-top10-2026.json:210`; `governance/owasp/README.md:69`).
- **No version manifest.** Eval results record only `provider`, `model`, `judgeProvider`, `timestamp` (`packages/evals/src/types.ts:71-78`). No git SHA, prompt hash, tool-list hash or policy hash, so no recorded prior version and no change log to generate.
- **No compensating actions** for mutating tools, and no rollback runbook.
- Neither PRD (`docs/PRD-Grade-Stack.md`, `docs/PRD-Grade-Stack-v2.md`) has a kill-switch or rollback requirement.

### Scorecard
- Not graded. Belongs under **D · Deployed** or **G · Governed**.
- The assessment methodology names a kill-switch and rollback verification record, tested and dated, which the repo cannot currently demonstrate.

### Smallest credible additions
1. **Gateway kill switch.** The gateway is already the only path to a model (ADR 0007; `packages/gateway/src/sandbox.ts`), so one check at the top of `GatewayService.generate` (`gateway.ts:77`) halts every agent behind it. Trigger with `RELIABILITY_HALT=1` or a halt file; return a `{policy: "kill-switch"}` violation. Add `reliability gateway halt|resume` and a test asserting no provider call after halt. About 30 lines.
2. **Release manifest.** Stamp `{gitSha, promptHash, model, tools[], policyHash}` into `EvalRunResult` and the root span, so reverting is a lookup and the change log generates itself.
3. **Test protocol template:** trigger, who can pull it, expected time-to-halt, in-flight handling, restoring the last good manifest, dated result. Plus a scorecard criterion under Deployed.

---

## 4. Human review queue: Missing

### What the code does
- No review queue exists. The output contract is `category / priority / sentiment / summary / draft_reply` (`reference-agent/src/triage-schema.ts`); no field means "needs review" and no store holds pending items.
- The **confidence router** computes the right signal, a self-consistency confidence (`packages/gateway/src/router.ts:138-198`), but below threshold it escalates to a frontier model (`router.ts:186-197`), not a person. The decision is then discarded (see section 2).
- `MaxTurnsError` (`pev.ts:53-63`) surfaces non-convergence as an exception, not a queued item.
- The only human approvals are dev-time change control: the `eval-approved` label (`ci.yml:40-46`; ADR 0004 line 47) and the reviewed re-baseline commit (ADR 0003 line 43).

### What is overclaimed
- `governance/eu-ai-act/eu-ai-act-deployer-2026.json:104-121` rates **Art 26 human oversight "supported"**, citing "Planner/Executor/Validator + human-reviewed drafts" and "Human-in-the-loop by design". Art 50 (lines 96-98) cites "drafts a reply a human sends". No code makes a human send anything. It is a deployment assumption rated as a shipped mechanism, against the "mechanisms, not prose" rule in `CLAUDE.md`, and the same kind of overclaim `docs/post-mortem.md:32` called out for OWASP.
- OWASP ASI09 is honest: a consequential deployment "should add explicit uncertainty disclosure and human-in-the-loop confirmation" (json:190).

### Scorecard
- Not graded. Belongs under **G · Governed** (who approved) and **A · Agentic** (autonomy level).
- The assessment methodology names a human oversight and escalation map. A map documents who should review; the pillar asks for the mechanism plus a record of who did.

### Smallest credible additions
1. **Review queue.** When router confidence is below threshold, a run hits max turns, or a guardrail redacts, write the item to `review-queue.jsonl` (or SQLite) as `pending`. Add `reliability review list | show <id> | approve <id> --as <name> | reject <id> --as <name> --reason`, recording approver and timestamp. "Send to human" becomes a third route beside "keep local" and "escalate to frontier". About 120 lines plus tests.
2. **Scorecard criterion:** consequential actions are held for a named approver and approval records are retained.
3. **Approval log sample** alongside the oversight map: 10 dated decisions with approver names.

---

## 5. Boundaries and protocols as autonomy increases: Partial

### What the code does (strong for a single agent)
- **Credential isolation.** The agent holds zero provider credentials: `STRIPPED_CREDENTIAL_VARS` and `isolatedAgentEnv` in `packages/gateway/src/sandbox.ts:18-61`; subprocess proof `packages/gateway/src/isolation-probe.ts`, tested at `packages/gateway/src/gateway.test.ts:131-156`. ADR 0007.
- **Single gateway path, no bypass.** Input policy, provider, output policy (`gateway.ts:60-105`). Input blocks prompt injection, secret exfiltration and the token cap (`policy.ts:118-158`); output blocks secrets and redacts PII (`policy.ts:177-202`); model allowlist (`policy.ts:161-169`).
- **Turn bound.** `DEFAULT_MAX_TURNS = 4` (`pev.ts:45-63, 139-211`; tests `pev.test.ts:127-141`).
- **Schema-enforced output.** `zodValidator` (`pev.ts:255-275`; ADR 0005).
- **MCP control split.** App-controlled resources versus model-controlled read-only tools (`packages/mcp-server/src/server.ts:43-128`); name-blind tool selection (`reference-agent/src/mcp.ts:104-144`; ADR 0006).
- **Air-gap egress guard.** Non-loopback `fetch` throws `EgressBlockedError` (`packages/core/src/airgap.ts:26-127`); `reliability sovereign verify` (`packages/cli/src/index.ts:269-282`).

### What is missing
- **No per-tool or per-agent scopes** (OWASP ASI02 residual, json:60).
- **No autonomy levels.** Nothing declares or enforces suggest-only versus act-with-approval versus autonomous.
- **No caller identity at the gateway.** `serveGateway` accepts any POST to `/v1/generate` (`connect.ts:53-80`) and `GatewayPolicy` is global (`policy.ts:20-29`). Two agents behind one gateway cannot have different boundaries or be told apart.
- **No agent-to-agent protocol.** ASI07 is a gap excluded from scoring as out of scope (json:137-151); ASI03 is "covered" only because a single agent has nothing to escalate (json:75).
- **No agent-to-human handoff** (section 4).

### Scorecard
- GRADE letter **A · Agentic**; no dimension computes it. The nearest, **Guardrail coverage** (`scorecard.ts:283-360`), comes from the committed JSON mapping (`packages/cli/src/index.ts:72-80, 665-666`), so it describes the reference design, not a deployed agent's actual permissions.

### Smallest credible additions
1. **Per-agent policy manifest** (`agents/<id>.json`: id, autonomy level L0 suggest / L1 act-with-approval / L2 act-and-notify / L3 autonomous, allowed tools, allowed models, max turns, review-required actions). The gateway authenticates callers with a per-agent bearer token and loads that manifest instead of `DEFAULT_POLICY`. Builds on the existing allowlist and token-cap code.
2. **Agentic dimension** comparing declared level and tool allowlist against observed `execute_tool` spans (`gen_ai.tool.name`, `mcp.ts:204-208`).
3. **Autonomy and boundary register:** one row per agent with level, tools, scopes, handoff rule, escalation owner; A2A stated as a scope boundary rather than left silent.

---

## Honesty fixes to make now

1. `governance/eu-ai-act/eu-ai-act-deployer-2026.json:104-121`: Art 26 human oversight from "supported" to "partial", noting human-in-the-loop is the deployer's process until a review queue exists. Adjust the Art 50 wording at lines 96-98 to match.
2. `governance/eu-ai-act/eu-ai-act-deployer-2026.json:122-140`: Art 12 / Art 26(6) logging from "supported" to "partial", and drop "durable" and "Strongest area" until the decision log, identity attributes and retention ship. Review the matching NIST MEASURE 3 / MANAGE 4 claims (`governance/nist/nist-ai-rmf-1.0-mapping.json:183-195, 253-265`).
3. `docs/production-readiness-assessment.md` is stale: it still says Guardrail and Governance are "stubbed" (lines 26-33, 144-155).
4. Scorecard dimensions do not match the GRADE letters (`scorecard.ts:447-475` versus the README). Either say so in the README or realign, starting with work item (d) below.

## Proposed work, smallest first

**(a) Honesty edits.** The two JSON downgrades above, plus the stale runbook note. Touches `governance/eu-ai-act/eu-ai-act-deployer-2026.json`, possibly `governance/nist/nist-ai-rmf-1.0-mapping.json`, and `docs/production-readiness-assessment.md`. Run `scripts/check-*.ts` after.

**(b) Three gateway mechanisms in one change.** Kill switch (about 30 lines), append-only decision log (about 40 lines), review queue with named approver (about 120 lines), each with tests and CLI verbs (`gateway halt|resume`, `review list|approve|reject`). Roughly a day. Touches `packages/gateway/src/gateway.ts`, `router.ts`, `connect.ts`, `packages/cli/src/index.ts`, and the gateway tests. Once shipped, revisit the downgrades in (a).

**(c) Release manifest.** Stamp `{gitSha, promptHash, model, tools[], policyHash}` into `EvalRunResult` and the root span. Touches `packages/evals/src/types.ts`, `packages/evals/src/run.ts`, `reference-agent/src/agent.ts`.

**(d) Per-agent policy manifest and an Agentic dimension.** Caller authentication plus `agents/<id>.json` loaded per request, then a scorecard dimension comparing declared boundaries with observed tool spans. Touches `packages/gateway/src/connect.ts`, `policy.ts`, `gateway.ts`, `packages/scorecard/src/scorecard.ts`, `packages/cli/src/index.ts`.

**(e) Post-deployment re-scoring.** `reliability eval run --from-traces <file>` re-scores sampled production runs, plus a judge-vs-human calibration set of about 20 labeled cases. Touches `packages/evals/src/run.ts`, `packages/cli/src/index.ts`, and depends on content capture from (b).

## What grade-stack has that the four pillars do not

- **Cost discipline as a graded dimension.** Cost-per-success and waste fraction, priced per provider including amortized self-hosting (`packages/evals/src/pricing.ts:17-105`; `scorecard.ts:135-190`), plus a CI cost cap (`gate.ts:90`).
- **Server-side guardrails the agent cannot switch off.** Injection denial, two-way secret-exfiltration denial, Luhn-checked PII redaction (`packages/gateway/src/policy.ts`).
- **Structural credential isolation** with a subprocess proof (ADR 0007).
- **Sovereign / air-gapped variant** with a live egress proof (`packages/core/src/airgap.ts`; `docs/sovereign-on-prem-variant.md`).
- **Confidence router.** Cheap local model first, low-confidence tail escalated to a frontier model (ADR 0015; `router.ts`), a reliability-per-dollar control.
- **Schema-enforced output contract** with bounded re-planning (PEV, ADR 0005).
- **Honest degradation.** A permanent degraded-mode canary proves the gate and scorecard get worse when the agent does.
- **Governance mappings enforced in CI.** OWASP Agentic Top 10 (2026), NIST AI RMF 1.0 and EU AI Act deployer duties, machine-readable and checked by `scripts/check-*.ts`, with covered / partial / gap ratings and stated residuals.
- **Evidence-gated scorecard.** No score is asserted without evidence, and unassessed dimensions say so.
- **Supply-chain hygiene.** gitleaks CI, a pinned lockfile, and name-blind tool selection against deceptive tool descriptions.
