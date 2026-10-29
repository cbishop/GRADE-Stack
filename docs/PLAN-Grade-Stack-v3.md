# Build Plan v3 — Grade Stack: the assurance loop

**Owner:** Clarke Bishop · **Status:** in progress. Written 2026-10-28 at commit `e5882b1`; Phase 4A complete 2026-10-28 (branch `v3-4a-honesty-grade-dimensions`); Phase 4B complete 2026-10-28 (branch `v3-4b-decision-log`); Phase 4C complete 2026-10-29 (branch `v3-4c-kill-switch-release-manifest`); Phase 4D complete 2026-10-29 (branch `v3-4d-review-queue`) · **Source of truth for what:** [`docs/PRD-Grade-Stack-v2.md`](./PRD-Grade-Stack-v2.md) (product context, stack, non-goals) plus [`docs/gap-analysis-assurance-loop-2026-10-28.md`](./gap-analysis-assurance-loop-2026-10-28.md) (the gaps v3 closes) · **Predecessor:** [`docs/PLAN-Grade-Stack-v2.md`](./PLAN-Grade-Stack-v2.md) (complete, 13 cycles)

v2 built the stack. v3 closes the four-pillar assurance loop the gap analysis measured it against: trusted evaluation, full traceability, rollback, and a human review queue, plus explicit boundaries as autonomy rises. Every sub-phase turns one "missing" or "partial" row of the gap table into a mechanism with a test that proves it bites, a readback that explains it in plain language, and a scorecard criterion computed from its record.

This plan carries its own acceptance contract. No PRD v3 is written unless the product context changes; the v2 PRD's stack, constraints, non-goals, and global definition of done still apply.

---

## Why v3, in one paragraph

The gap analysis found two pillars with no code at all (rollback, human review), two rated "supported" in the governance JSON without a mechanism behind them (oversight, logging), a scorecard whose dimensions do not match the five GRADE letters the README promises, and a CI eval gate that has never touched a real model. Those are the things a bank's model-risk reviewer asks about first, and they are the artifacts the Assessment sells (kill-switch record, oversight map, change log, monitoring thresholds, issue register; see `cto-sales/docs/assessment-one-pager.md`). v3 makes the stack produce that evidence instead of describing it.

---

## Changes from v2

1. **Six sub-phases, sized in days, not fortnights.** The gap analysis estimates each mechanism at 30 to 120 lines plus tests. The sub-phases below run roughly half a day to two days each; about eight working days in total.
2. **Test-first is now a rule, not a habit.** Every sub-phase's first task is the failing test that proves the mechanism bites (the degraded-mode canary is the model). A mechanism without a bite test is not done.
3. **Readback is a deliverable.** Every record the stack writes (decision log, halt record, review queue, release manifest, eval record) gets a CLI verb that prints it in plain English for a non-technical reader. If the readback cannot be pasted into a board memo, the record is mis-scoped.
4. **Scorecard dimensions become the GRADE letters.** The five code dimensions regroup under G, R, A, D, E in 4A. New criteria appear first as stubs that name the sub-phase that fills them, exactly as v2's `stubDimension` named Phase 2D, 3A and 3C. The scorecard tells the truth about what is missing from day one.
5. **Honesty edits ship before any code.** The two governance overclaims and the stale runbook are fixed in 4A; they are upgraded again only when a later sub-phase ships the mechanism and the check script's "names a mechanism" rule is met.
6. **Records are append-only JSONL, hashes before content.** All new stores (decision log, review queue, drill records) are line-delimited JSON with Zod schemas, opened append-only, grep-able, and hold SHA-256 hashes of inputs and outputs by default. Raw content capture is opt-in. No SQLite, no database, no new runtime dependency (ADR candidate 0017).
7. **Two chokepoints, one manifest.** Per-agent boundaries are enforced where each boundary actually lives: models, turns, tokens and review at the gateway; tool scopes at the MCP server. Both read the same `agents/<id>.json` and both write to the same decision log (ADR candidate 0020).
8. **Content cadence lightened.** One end-of-cycle post per sub-phase in `content/cycle-13/` onward, not two. The mid-cycle post is optional. The walkthrough series already covers the v2 build.
9. **Evidence-pack export is explicitly deferred** until a buyer appears, consistent with the current sales focus. v3 produces the records; packaging them is a one-day follow-up when it is needed.

---

## How to use this plan

- **Work one sub-phase at a time**, in order. The order is by value with dependencies respected (see the rationale table at the end). Do not pull scope forward.
- **The acceptance criteria are the contract.** A sub-phase is done when every checkbox is checked, the bite test is in `bun run test`, the readback verb exists, the scorecard criterion is computed, the enforcement register row is added, and the end-of-cycle post draft exists.
- **Mechanisms, not prose.** Unchanged from v2 and `CLAUDE.md`.
- **Record every deviation as an ADR.** Candidates are numbered 0016 to 0021 below.
- **Kickoff prompt per sub-phase:**
  > *"Read `docs/PLAN-Grade-Stack-v3.md`, `docs/gap-analysis-assurance-loop-2026-10-28.md`, and `CLAUDE.md`. We are starting Phase 4[X]. Write the bite test first, then implement only that sub-phase. Stop at its acceptance criteria."*

---

## v3 conventions (in addition to every v2 rule)

**Stack:** unchanged. Bun, TypeScript strict, Commander, promptfoo, OTel, MCP, Bedrock and Ollama through `@grade-stack/core`, Apache-2.0.

**Testability first, per sub-phase:**
1. The first commit on the branch is a failing test that asserts the mechanism's effect (a spy provider is never called after halt; one log line per gateway request; an unknown bearer token gets 401).
2. Every record has a Zod schema and a schema test; malformed lines fail loudly, never silently skip.
3. Every mechanism is exercised by the built binary smoke test (`packages/cli/src/cli.smoke.test.ts`), not only by source-run unit tests. v2's post-mortem found a binary that could not do what the tests said it could.
4. Degraded mode stays the canary: where a new scorecard criterion exists, `RELIABILITY_DEGRADED=1` or an equivalent flag must be able to make it fail.

**Explainability first, per sub-phase:**
1. Every record line answers who, what, why, when: an actor or caller id, the action, the policy or reason that fired, an ISO timestamp, and a request id that links it to the trace.
2. Every CLI readback has a default plain-language mode and a `--json` mode. Plain language means a sentence a board member can read ("Request 7f3a from agent `triage` at 10:14: input blocked by policy prompt-injection; no model call made").
3. Every scorecard criterion cites the record it was computed from (file and id), the threshold applied, and what would change the grade. Unassessed criteria say which sub-phase fills them.
4. Docs written for each sub-phase are templates a deployer fills in, not essays: the logging and retention record, the rollback protocol, the oversight map, the boundary register, the eval record.

**Commit hygiene:** standard messages, no AI-tool attribution.

---

## Phase 4 — The assurance loop

### Phase 4A — Honesty edits and GRADE-letter scorecard realignment (about half a day)

**Objective:** Stop overclaiming, and make the scorecard explain the five letters it is named for, with every missing criterion visibly stubbed and attributed to the sub-phase that fills it. Nothing else changes. **Branch:** `v3-4a-honesty-grade-dimensions`

**Why first:** zero risk, pure honesty, and it gives every later sub-phase a slot to fill. After 4A the scorecard is the living map of v3 progress.

**Tasks (ordered):**
1. **Test first:** a scorecard test asserting that the five dimension ids are `governed`, `reliable`, `agentic`, `deployed`, `evaluated`, that each unassessed criterion names a `fillsIn` sub-phase, and that the overall verdict still names the weakest dimension. Update the snapshot tests after the regroup.
2. **Governance downgrades.** `governance/eu-ai-act/eu-ai-act-deployer-2026.json`: Art 26 human oversight from `supported` to `partial` (human-in-the-loop is the deployer's process until 4D ships); Art 50 wording to match; Art 12 / Art 26(6) logging from `supported` to `partial`, dropping "durable" and "Strongest area" until 4B ships. Review NIST MEASURE 3 and MANAGE 4 in `governance/nist/nist-ai-rmf-1.0-mapping.json` for the same claims. `bun run check` must stay green: a `partial` must still name a mechanism and a residual.
3. **Stale runbook.** `docs/production-readiness-assessment.md` still says Guardrail and Governance are stubbed; fix it.
4. **Regroup the scorecard** (`packages/scorecard/src/scorecard.ts`). Each dimension now holds named criteria, each criterion either computed (with evidence citation) or stubbed with `fillsIn`. Default mapping, recorded as **ADR 0016**:

   | Letter | Computed today (from v2) | Stubbed until |
   |---|---|---|
   | **G · Governed** | Governance readiness (EU AI Act, NIST) | Human oversight record (4D); boundary register (4E) |
   | **R · Reliable** | Reliability (pass rate, stability floor); Cost discipline (cost-per-success, waste) | none |
   | **A · Agentic** | Guardrail coverage (OWASP applicable threats, no-true-gaps floor) | Declared vs observed autonomy and tool scope (4E) |
   | **D · Deployed** | Observability coverage (connected trace, three phases) | Attributable and reconstructable (4B); rollback verified (4C) |
   | **E · Evaluated** | Suite breadth, computed from the results file (case count ≥ 10, refusal or OOD case present, judge metric present) | Last real-model run freshness, judge calibration, post-deployment re-score (4F) |

   Cost discipline stays a graded sub-score under R because the router and the cost cap are reliability-per-dollar controls; it is the one thing the four pillars do not grade, and it must not get lost. Band thresholds and the `standardBand` helper are unchanged.
5. **README.** The scorecard section now says the dimensions are the five letters; drop the mismatch.
6. **Regenerate** the sample scorecard under `content/cycle-13/` and leave older cycle samples as snapshots.

**Acceptance criteria:**
- [x] `reliability scorecard` prints five dimensions named G, R, A, D, E; every stubbed criterion says which sub-phase fills it.
- [x] EU AI Act Art 26 and Art 12 / 26(6) read `partial`; `bun run check` (all governance checks) is green.
- [x] `docs/production-readiness-assessment.md` no longer calls any dimension stubbed.
- [x] Degraded mode still drops R; built-binary smoke test passes.
- [x] **ADR 0016** records the letter mapping and where Cost discipline lives.
- [x] **Artifact:** post draft in `content/cycle-13/`: "the scorecard now admits what it cannot grade yet."

---

### Phase 4B — Traceability: the gateway decision log and request identity (about one day)

**Objective:** Every request through the gateway leaves an attributable, append-only record of what was decided and why, linked to the trace. **Branch:** `v3-4b-decision-log`

**Why second:** it is the explainability substrate. The kill switch (4C), the review queue (4D) and the boundary enforcement (4E) all write to this log; building it first means each later mechanism is explainable the moment it ships. Closes gap table row 2.

**Tasks (ordered):**
1. **Test first** (`packages/gateway/src/decision-log.test.ts` and additions to `gateway.test.ts`): exactly one line per `generate` call for the allow, input-block (injection), output-redact, and router-escalate paths; the line carries request id, caller id, action, policy, `servedBy`, `escalated`, `confidence`, input and output SHA-256, token counts and latency; no raw prompt or output text by default; two writers appending concurrently lose no lines; a malformed line fails schema validation loudly.
2. **Request identity.** Add a `RequestContext` (`requestId`, optional `callerId`, optional `sessionId`) to the gateway request envelope in `packages/gateway/src/gateway.ts`. The HTTP adapter (`connect.ts`) reads `x-request-id` and `x-caller-id`, generating a request id when absent. In 4B the caller id is a trusted header (dev only, logged as `unverified`); 4E authenticates it.
3. **Decision log writer** (`packages/gateway/src/decision-log.ts`). Zod `DecisionRecord`; path from `RELIABILITY_DECISION_LOG` (default `./gateway-decisions.jsonl`); opened with append-only flags; never truncated by the stack. About 40 lines.
4. **Span attributes.** `grade_stack.request_id`, `grade_stack.caller_id` and `enduser.id` on the root and `chat` spans (`packages/core/src/tracing.ts`), so a log line and a trace join on request id.
5. **Content capture, opt-in.** `RELIABILITY_TRACE_CONTENT=1` records the prompt on `chat` spans and the post-redaction output on the request span, and mirrors them to a local capture file (`RELIABILITY_CAPTURE_DIR`, one JSON per request id). This is the input 4F re-scores. Off by default; the sovereign variant's egress guard is unaffected because capture is local.
6. **Readback.** `reliability gateway log [--since <iso>] [--request <id>] [--caller <id>] [--json]`. Plain mode prints one sentence per record.
7. **Scorecard D criteria** become computed when `reliability scorecard --decision-log <file>` is given: *attributable* (every record has request and caller ids), *reconstructable* (content capture on and a retention period stated in the logging record). Degraded: a log with missing caller ids drops D.
8. **Docs:** `docs/logging-and-retention.md`, a template: what is logged, where, for how long, who can read it, and one reconstructed sample run (log line plus trace plus captured content).
9. **Governance:** revisit Art 12 / 26(6) and NIST MEASURE 3 / MANAGE 4. Upgrade to `supported` only if the check script's "names a mechanism" rule is satisfied by the decision log and the residual (retention is the deployer's policy) is stated.

**Acceptance criteria:**
- [x] A blocked injection, a PII redaction, and a frontier escalation each produce one log line that `reliability gateway log` explains in a sentence. *Evidence: `gateway.test.ts` (one line per allow, input-block, output-redact, router-escalate and error path); built-binary smoke test drives `gateway serve` and reads three lines back; manual run against Ollama in `content/cycle-14/sample-decision-log.jsonl`.*
- [x] A log line and its trace share a request id; `enduser.id` appears on spans when a caller id is supplied. *Evidence: `gateway.test.ts` "a log line and its trace share a request id"; `tracing.test.ts` identity tests; sample spans in `docs/logging-and-retention.md`.*
- [x] No prompt or output text in the log by default; with `RELIABILITY_TRACE_CONTENT=1` a run is fully reconstructable from the capture directory. *Evidence: strict `DecisionRecordSchema` refuses text fields; `gateway.test.ts` content-capture tests (default leaves no content anywhere; capture hashes back to the log line); smoke test greps the log for prompt text.*
- [x] Scorecard D shows *attributable* and *reconstructable* as computed criteria citing the log file. *Evidence: `reliability scorecard --decision-log <file>`; `scorecard.test.ts` D criteria tests and degraded canary; smoke test; `content/cycle-14/sample-scorecard.md`.*
- [x] `docs/logging-and-retention.md` exists with one reconstructed run. *Evidence: fill-in template plus a real 2026-10-28 Ollama run (log line, span attributes, capture, hash check).*
- [x] **ADR 0017** records the JSONL, append-only, hashes-by-default decision. *Evidence: `docs/decisions/0017-decision-log-jsonl-append-only-hashes-by-default.md`.*
- [x] **Artifact:** post draft in `content/cycle-14/`: "what your gateway refused today, and why, in one file." *Evidence: `content/cycle-14/endofcycle-post.md`.*

---

### Phase 4C — Rollback: kill switch, release manifest, and a dated drill (about one day)

**Objective:** Any operator can halt every agent behind the gateway in seconds, prove it, and name exactly which version to restore. **Branch:** `v3-4c-kill-switch-release-manifest`

**Why third:** rollback is one of the two pillars with no code, the OWASP ASI10 residual admits it, and the Assessment promises a "kill-switch record, tested and dated." It is also the smallest of the two missing pillars. Closes gap table row 3.

**Tasks (ordered):**
1. **Test first:** with a spy provider, after halt `generate` returns `{ ok: false, violation: { policy: "kill-switch" } }` and the provider is never called; the halt and the resume each write a decision-log line with actor and reason; resume restores normal service; the router path and the plain forward path both honour the halt.
2. **Kill switch** at the top of `GatewayService.generate` (`gateway.ts`). Two triggers, checked per request so a running gateway halts without restart: `RELIABILITY_HALT=1` (process-level) and a halt file (`RELIABILITY_HALT_FILE`, default `.reliability-halt`, contents `{ by, reason, at }`). About 30 lines.
3. **CLI:** `reliability gateway halt --by <name> --reason <text>` and `reliability gateway resume --by <name>`. Both log to the decision log and print what they did.
4. **Release manifest** (`packages/core/src/release.ts`): `{ gitSha, dirty, promptHash, model, provider, tools[] (name plus arg-schema hash), policyHash, builtAt }`. Stamped into `EvalRunResult.release` (`packages/evals/src/types.ts`, `run.ts`) and onto the root span (`reference-agent/src/agent.ts`). The committed baselines gain the manifest.
5. **Readback:** `reliability release show` prints the current manifest; `reliability release diff <a.json> <b.json>` prints what changed between two eval results ("prompt hash changed; model unchanged; tool `lookup_order` added"). The gate's regression message names the diff. The change log now generates itself.
6. **Rollback drill:** `scripts/rollback-drill.ts` halts the stub gateway, measures time-to-halt, confirms zero provider calls, resumes, and writes a dated record to `governance/drills/kill-switch-<date>.json` (Zod schema). `docs/rollback-protocol.md` is the template: trigger, who can pull it, expected time-to-halt, in-flight handling, restoring the last good manifest, dated result.
7. **Scorecard D criterion** *rollback verified*: computed from the latest drill record (exists, dated within 90 days, time-to-halt under the stated threshold, zero provider calls after halt). Degraded: a stale or missing drill drops D.
8. **Governance:** OWASP ASI10 residual narrows to "no runtime anomaly detector"; the kill switch is now the named mechanism.

**Acceptance criteria:**
- [x] `reliability gateway halt` followed by `reliability agent run` yields a kill-switch violation and no model call; `resume` restores it. *Evidence: `kill-switch.test.ts` (spy provider never resolved or called after halt, plain and router paths, halt file and `RELIABILITY_HALT=1`); built-binary smoke test halts a running `gateway serve`, `agent run` exits 1 with policy kill-switch, every logged line while halted has `servedBy: null`, resume restores.*
- [x] Eval results and the root span carry the release manifest; `release diff` explains a prompt change in one sentence. *Evidence: `EvalRunResult.release` stamped by `runEvalSuite`; `agent.run` span carries `grade_stack.release.*` (`trace.test.ts`); `release.test.ts`, `gate.test.ts` (regression names the diff); committed stub baseline carries its manifest; smoke test runs `release show` and `release diff`.*
- [x] `bun scripts/rollback-drill.ts` writes a dated drill record and the scorecard cites it. *Evidence: `governance/drills/kill-switch-2026-10-29.json` (143.2 ms to halt, 0 provider calls after halt); `reliability scorecard --drills governance/drills` grades Rollback verified Strong citing the file; `scorecard.test.ts` and the smoke test cover stale, missing, degraded and malformed drills.*
- [x] `docs/rollback-protocol.md` exists as a fill-in template with the drill's dated result. *Evidence: trigger, who can pull it, time-to-halt, in-flight handling, restoring the last good manifest, and the 2026-10-29 drill table.*
- [x] **ADR 0018** records halt-file plus env triggers and the manifest fields. *Evidence: `docs/decisions/0018-kill-switch-halt-file-and-env-triggers-and-release-manifest.md`.*
- [x] **Artifact:** post draft in `content/cycle-15/`: "we pulled the kill switch on purpose; here is the record." *Evidence: `content/cycle-15/endofcycle-post.md` and `content/cycle-15/sample-scorecard.md`.*

---

### Phase 4D — Human review queue: the third route (about one and a half days)

**Objective:** Low-confidence, non-converging, or redacted outputs are held for a named human, and every approval or rejection is recorded with who and when. **Branch:** `v3-4d-review-queue`

**Why fourth:** the second pillar with no code, and the one the EU AI Act Art 26 overclaim sits on. The router already computes the right signal; this sub-phase gives it a third destination beside "keep local" and "escalate to frontier." Closes gap table row 4.

**Tasks (ordered):**
1. **Test first** (`packages/gateway/src/review-queue.test.ts`): a routing result below the `reviewBelow` threshold queues a `pending` item and the gateway response carries `review: { held: true, id, reason }`; a `MaxTurnsError` queues an item; an output redaction queues an item when the policy says so; `approve --as` and `reject --as --reason` append events with approver and timestamp; state is derived from the event stream; an item cannot be approved twice; no code path auto-approves.
2. **Triggers,** configurable in `GatewayPolicy`: router confidence below `reviewBelow` after escalation (order is local, then frontier, then human), max-turn failure, output redaction, or an explicit `requiresReview` flag on the request (used by L1 agents in 4E).
3. **Store** (`packages/gateway/src/review-queue.ts`): append-only JSONL of events (`queued`, `approved`, `rejected`), Zod schema, path from `RELIABILITY_REVIEW_QUEUE` (default `./review-queue.jsonl`). Each event also writes a decision-log line. About 120 lines.
4. **CLI:** `reliability review list [--pending]`, `show <id>`, `approve <id> --as <name> [--note]`, `reject <id> --as <name> --reason <text>`. `show` explains why the item was held ("confidence 0.41 below the review threshold 0.60 after frontier escalation").
5. **Reference agent:** the triage output gains `review: { required, reason, id }`; `reliability agent run` prints "held for review" when it applies; the gateway demo shows one held draft.
6. **Scorecard G criterion** *human oversight*: computed from the queue file: held items exist for each configured trigger, every resolved item has an approver and timestamp, zero auto-approvals. Degraded: an item resolved without an approver drops G.
7. **Docs:** `docs/human-oversight-map.md`, a template with the trigger table, who reviews what, the escalation owner, and a sample approval log of ten dated decisions produced by a scripted drill and labeled as sample data.
8. **Governance:** EU Art 26 may return to `supported` with the residual "the deployer must staff the queue"; Art 50 wording to match; OWASP ASI09 residual updated.

**Acceptance criteria:**
- [x] A low-confidence run is held; `review show` explains why; `approve --as clarke` records approver and time; the decision log shows the whole chain. *Evidence: `review-queue.test.ts` (confidence 0.40 below `reviewBelow` 0.60 after escalation queues a pending item, response carries `review`); built-binary smoke test: a held `agent run` prints "held for review", `review show` gives the reason, `approve --as you` records name and ISO time and refuses a second, automated or empty approval, `gateway log --request` prints request, hold and approval.*
- [x] Max-turn failures and redactions queue items when configured. *Evidence: `review-queue.test.ts` (`holdMaxTurns` and `POST /v1/review` via `GatewayProvider.requestReview`; redaction held only with `onRedaction`; `requiresReview` flag held; each switch off holds nothing); smoke test `agent run --max-turns 0` prints "held for review".*
- [x] Scorecard G shows *human oversight* computed from the queue, citing it. *Evidence: `reliability scorecard --review-queue <file>`; `scorecard.test.ts` bands plus canaries (unattributed or automated decision drops G to Critical); smoke test (Strong from a live queue and from the drill, Critical for a self-approval, loud failure for an approval with no `by`); `content/cycle-16/sample-scorecard.md`.*
- [x] `docs/human-oversight-map.md` exists with the sample approval log. *Evidence: fill-in template (triggers, who reviews what, escalation owner, release step) with ten dated decisions from `bun scripts/review-drill.ts`, labeled sample data; records in `governance/drills/review-queue-2026-10-29.jsonl` and `review-decisions-2026-10-29.jsonl`.*
- [x] **ADR 0019** records the event-log store and the three-route order. *Evidence: `docs/decisions/0019-review-queue-event-log-and-three-route-order.md`.*
- [x] **Artifact:** post draft in `content/cycle-16/`: "the router's third route is a person." *Evidence: `content/cycle-16/endofcycle-post.md` and `content/cycle-16/sample-scorecard.md`.*

---

### Phase 4E — Boundaries: per-agent manifest, caller authentication, and the Agentic dimension (about two days)

**Objective:** Two agents behind one gateway can be told apart, given different autonomy levels, models, tools and turn limits, and the scorecard grades declared boundaries against observed behaviour. **Branch:** `v3-4e-agent-manifest-agentic-dimension`

**Why fifth:** it depends on identity (4B) and the review trigger (4D), and it is the largest change. It gives the A letter its first real computation. Closes gap table row 5.

**Tasks (ordered):**
1. **Test first:** two manifests behind one gateway; agent A's bearer token cannot use agent B's model or exceed A's turn or token cap; an unknown token gets 401 and a decision-log line; an L0 agent's tool call is refused by the MCP server with `tool-not-allowed` and logged; an L1 agent's response is held for review automatically; the authenticated caller id replaces the 4B trusted header.
2. **Manifest schema** (`packages/gateway/src/agent-manifest.ts`, Zod): `id`, `owner`, `autonomyLevel` (`L0` suggest only, `L1` act with approval, `L2` act and notify, `L3` autonomous), `allowedTools`, `allowedModels`, `maxTurns`, `tokenCap`, `reviewRequired`. Files live in `agents/<id>.json`; the reference agent gets `agents/triage.json` at L1.
3. **Caller authentication** in `connect.ts`: bearer tokens from `RELIABILITY_AGENT_TOKENS` (`id:token,...`) or a tokens file. When any manifest is present, unauthenticated requests are refused; with no manifests the single-agent behaviour of v2 is unchanged and the caller is logged as `anonymous`. The per-request policy is built from the manifest on top of `DEFAULT_POLICY` (model allowlist and token cap already exist in `policy.ts`).
4. **Tool scope at the MCP server** (`packages/mcp-server/src/server.ts`): the agent presents its token; the server loads the same manifest and refuses undeclared tools before execution, logging to the decision log. The gateway cannot see tool calls, so the tool boundary is enforced where tools run. This is the two-chokepoint model of **ADR 0020**.
5. **Readback:** `reliability agents list` and `reliability agents show <id>` print each agent's level, owner, tools, models and limits in plain language.
6. **Scorecard A criteria** computed from manifests plus the decision log and `execute_tool` spans: *every observed tool is declared*, *no call exceeded the declared level* (an L0 agent made zero tool calls; an L1 agent's actions were held), *every record carries an authenticated caller*. Degraded: an undeclared tool call drops A.
7. **Docs:** `docs/autonomy-boundary-register.md`, one row per agent (level, tools, scopes, handoff rule, escalation owner), with agent-to-agent protocol stated as an out-of-scope boundary rather than left silent. OWASP ASI02 and ASI03 residuals updated.

**Acceptance criteria:**
- [x] Two agents with different manifests behind one gateway are enforced differently; the bite tests above pass. *Evidence: `agent-boundary.test.ts` (A's token refused B's model, A's own token and turn caps, unknown or missing token 401 plus an `auth` line, disagreeing `x-caller-id` refused, L1 held without asking, verified caller, v2 unchanged as `anonymous`); `agent-manifest.test.ts` schema tests; built-binary smoke test with two manifests.*
- [x] An undeclared tool call is refused at the MCP server and appears in the decision log with the caller id. *Evidence: `tool-scope.test.ts` (L0 call refused `tool-not-allowed` before it runs, logged as `tool` with `callerId` and `callerVerified`; HTTP and stdio); smoke test against the built `mcp serve --http`; `content/cycle-17/sample-decision-log.jsonl` (Ollama run).*
- [x] Scorecard A is computed, cites the manifest and log, and degrades on an undeclared tool call. *Evidence: `reliability scorecard --agents <dir> --decision-log <file>`; `scorecard.test.ts` (three A criteria, G boundary register, attributable cap lifted; canary: an undeclared call that ran is Critical); smoke test (Adequate on a refused attempt, Critical on the fixture); `content/cycle-17/sample-scorecard.md`.*
- [x] `docs/autonomy-boundary-register.md` exists with the reference agent's row. *Evidence: fill-in template with the four levels, `triage` (L1) and a labeled sample `helpdesk` (L0) row, and agent-to-agent protocol stated as an out-of-scope boundary.*
- [x] **ADR 0020** records the manifest, bearer tokens, and the two-chokepoint enforcement. *Evidence: `docs/decisions/0020-agent-manifest-bearer-tokens-two-chokepoints.md`.*
- [x] **Artifact:** post draft in `content/cycle-17/`: "L0 to L3: say how much your agent may do, then prove it did no more." *Evidence: `content/cycle-17/endofcycle-post.md` and `content/cycle-17/sample-scorecard.md`.*

---

### Phase 4F — Evaluated: real-model runs, judge calibration, and post-deployment re-scoring (about two days)

**Objective:** The eval suite is trusted because it has run on a real model recently, its judge agrees with a human on a labeled set, and production runs are re-scored on a cadence. **Branch:** `v3-4f-eval-record-post-deploy`

**Why last:** it is the only sub-phase that needs cloud secrets in CI and Clarke's own labeling time, and `--from-traces` depends on 4B's content capture. The E letter is stubbed until here. Closes gap table row 1 and the deferred real-Bedrock job from Phase 1B.

**Tasks (ordered):**
1. **Test first:** `reliability eval run --from-traces <capture-dir>` re-scores captured runs through the same assertions and stamps `source: "traces"`; `reliability eval calibrate --labels <file>` computes judge-versus-human agreement from a labeled file and exits non-zero below the threshold; `reliability eval record` produces the eval record from results files.
2. **Real-model eval job.** A scheduled (nightly) and `workflow_dispatch` job on `main` runs the full suite against Bedrock under the existing cost cap and uploads the results as a CI artifact. PR gating stays on the stub (ADR 0003 stands). A reviewed `baseline.bedrock.json` is committed once two consecutive nightly runs agree within the tolerance band. Needs AWS credentials as GitHub secrets, which is Clarke's action, not code.
3. **Judge calibration set.** `packages/evals/calibration/labels.json`: about 20 cases hand-labeled by Clarke (pass or fail per assertion the judge scores). `eval calibrate` reports simple agreement and Cohen's kappa; the threshold is recorded in the eval record.
4. **Post-deployment re-scoring.** `--from-traces` consumes the 4B capture directory; results include the request ids so a failing production run is traceable to its log line and review item.
5. **Eval record.** `reliability eval record` generates `docs/eval-record.md`: suite definition hash, committed baselines, last real-model run (date, model, result), calibration agreement, last production re-score date.
6. **Scorecard E criteria** computed from the eval record: *freshness* (last real-model run within 30 days), *calibration* (agreement at or above the threshold), *post-deployment* (a production sample re-scored within 30 days), plus the 4A suite-breadth criterion. Degraded: a stale record drops E.
7. **Local Stop hook.** Wire `.claude/hooks/eval-gate.sh` to the stub gate (seconds, hermetic) so the `CLAUDE.md` promise is finally true, or delete both the placeholder and the promise. Default: wire it.

**Acceptance criteria:**
- [ ] Nightly real-model job runs on `main` under the cost cap; a Bedrock baseline is committed after two agreeing runs.
- [ ] `eval calibrate` reports agreement on the labeled set and fails below threshold.
- [ ] `eval run --from-traces` re-scores a captured production sample with request ids preserved.
- [ ] `docs/eval-record.md` is generated, and scorecard E is fully computed and cites it.
- [ ] The local Stop hook runs the stub gate or is removed together with its promise.
- [ ] **ADR 0021** records the nightly job, calibration threshold, and trace re-scoring.
- [ ] **Artifact:** post draft in `content/cycle-18/`: "an eval you have not run on the real model lately is a belief, not a measurement."

---

## Deferred, not in v3

- **Evidence-pack export** (`reliability evidence export`, bundling the v3 records into the nine-artifact Assessment pack). One day of work once a buyer exists; the records it would package all ship in v3.
- **Compensating actions and mutating tools.** The reference agent only drafts text; adding a mutating tool to demonstrate undo is a new reference-task decision.
- **Agent-to-agent protocol** (OWASP ASI07). Stated as a boundary in 4E's register; not built.
- **Runtime anomaly detection.** The kill switch is manual; automatic triggers (error-rate, cost spike) are a follow-up.
- **A database store.** JSONL is deliberate; revisit only if a deployer needs concurrent multi-host writers.

---

## Enforcement-mechanism register (rows v3 adds)

| Rule | Mechanism | Introduced |
|---|---|---|
| Scorecard cannot claim a letter it has no evidence for | Each criterion is computed with a citation or stubbed with `fillsIn`; test asserts no third state | 4A |
| Governance JSON cannot rate `supported` without a shipped mechanism | Existing `check-*` scripts, now with the two overclaims corrected | 4A |
| Every gateway decision is recorded | One append-only decision-log line per `generate`, schema-validated; test asserts one line per path | 4B |
| No raw content leaves the default path | Content capture is opt-in; test asserts the log holds hashes only | 4B |
| Every agent can be halted without restart | Per-request halt-file and env check at the top of `generate`; test asserts zero provider calls after halt | 4C |
| Every eval result names the version it measured | Release manifest stamped into results and the root span; the gate names the diff on regression | 4C |
| Low-confidence output cannot ship unreviewed | Third route queues the item; approval needs a named approver; test asserts no auto-approve path | 4D |
| Agents cannot exceed their declared boundaries | Manifest enforced at the gateway (models, turns, tokens, review) and the MCP server (tools); unknown callers refused | 4E |
| Judge trust is measured, not assumed | `eval calibrate` fails below the agreement threshold; freshness drops E | 4F |

## ADR candidates

0016 GRADE-letter dimension realignment · 0017 decision log format, identity attributes, hashes-by-default · 0018 kill switch triggers and release manifest · 0019 review queue as an event log and the three-route order · 0020 per-agent manifest, bearer tokens, two-chokepoint enforcement · 0021 nightly real-model job, judge calibration, trace re-scoring.

## Verification (from a clean clone, at each sub-phase boundary)

- **4A:** `reliability scorecard` shows G, R, A, D, E with stubs naming 4B to 4F; `bun run check` green; EU JSON reads `partial` for Art 26 and Art 12.
- **4B:** run the gateway demo with an injection, a PII reply and a low-confidence case; `reliability gateway log` explains three lines; grep the log for prompt text and find none.
- **4C:** `reliability gateway halt --by you --reason drill` then `reliability agent run` fails with kill-switch; `release diff` between two results names the change; a dated drill record exists.
- **4D:** a held item appears in `review list`; `approve --as you` writes approver and time; the scorecard's G cites the queue.
- **4E:** start the gateway with two manifests; the wrong token is refused; an undeclared tool is refused at the MCP server; scorecard A degrades when you call it anyway.
- **4F:** nightly job green on `main`; `eval calibrate` prints agreement; `eval run --from-traces` re-scores yesterday's capture; scorecard E is fully computed.

**Final gate:** every sub-phase's checkboxes checked; every new record has a schema, a bite test, a readback verb, a scorecard criterion and a register row; six ADRs filed; the gap analysis table re-read with every row moved to "covered" or an honest "partial" with a named residual.

## Order rationale

| Sub-phase | Pillar | Gap today | Value | Depends on | Size |
|---|---|---|---|---|---|
| 4A | all | overclaims, letters mismatch | honesty, progress map | none | 0.5 d |
| 4B | traceability | partial | explainability substrate for everything after | none | 1 d |
| 4C | rollback | missing | smallest missing pillar; Assessment's kill-switch record | 4B (log) | 1 d |
| 4D | human review | missing | second missing pillar; fixes the Art 26 overclaim | 4B (log) | 1.5 d |
| 4E | boundaries | partial | first real A computation; multi-agent readiness | 4B (identity), 4D (review trigger) | 2 d |
| 4F | evaluation | partial | trust in the suite itself; needs secrets and labeling time | 4B (capture) | 2 d |
