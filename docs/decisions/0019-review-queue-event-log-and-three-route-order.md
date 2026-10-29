# ADR 0019: The human review queue: an event-log store and the three-route order

- **Status:** Accepted
- **Date:** 2026-10-29
- **Phase:** 4D (human review queue: the third route)

## Context

Human oversight was the second assurance pillar with no code. The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`, row 4) found nothing that
held an output for a person and no record of who approved what. The EU AI Act
Art 26 oversight entry had been downgraded to `partial` in 4A for exactly that
reason, and OWASP ASI09's residual asked for human-in-the-loop confirmation.

The confidence router (ADR 0015) already computes the right signal: how much
the local model agreed with itself. It had two destinations, keep local or
escalate to the frontier. A frontier answer to a question the local model could
not settle is better than nothing, but it is not checked. The agent's turn
bound (`MaxTurnsError`) already stops a loop that cannot converge, and the
output guardrail already redacts PII; neither told a person.

## Decision

**1. Three routes, in order: local, then frontier, then a person.** The
router's two routes are unchanged. After the output guardrails, a result the
gateway is about to release can be *held* for a named person. Only a released
result can be held: a blocked request returned nothing to review. One item per
request. When several triggers fire, the request's own flag wins, then low
confidence, then a redaction.

**2. Four triggers, configured in `GatewayPolicy.review`:**

| Trigger | Fires when | Setting (env) | Default |
|---|---|---|---|
| `low-confidence` | the router escalated and local agreement was below `reviewBelow` | `reviewBelow` (`RELIABILITY_REVIEW_BELOW`, 0..1 or `off`) | off |
| `max-turns` | the agent hit its turn bound without converging and reported it | `onMaxTurns` (`RELIABILITY_REVIEW_ON_MAX_TURNS`) | on |
| `output-redaction` | the PII redaction changed the answer | `onRedaction` (`RELIABILITY_REVIEW_ON_REDACTION`) | off |
| `requested` | the request set `requiresReview: true` | `onRequest` (`RELIABILITY_REVIEW_ON_REQUEST`) | on |

Low confidence applies only after escalation, so the order holds by
construction: a request the local tier settled is never held for confidence,
whatever `reviewBelow` says. A `reviewBelow` above the router threshold holds
every escalation. `serveGateway` reads the env the way it reads the router's;
an injected policy wins. A bad value (`RELIABILITY_REVIEW_BELOW=1.5`) throws at
start rather than silently defaulting. `requiresReview` is how L1 agents will
ask for review in 4E; nothing in the reference agent sets it yet.

**3. A hold flags the result; it does not withhold it.** The response stays
`ok: true` with the (redacted) result and gains `review: { held: true, id,
trigger, reason }`. The reason is one sentence: "confidence 0.40 below the
review threshold 0.60 after frontier escalation to bedrock". The request's
decision-log line names the item (`reviewId`), and the queued event records the
SHA-256 of the exact text returned, so an approval is bound to that text. The
reference agent's triage gains `review: { required, reason, id }` and `agent
run` prints "held for review".

**4. The store is an append-only event log.** `RELIABILITY_REVIEW_QUEUE`
(default `./review-queue.jsonl`) holds one JSON line per event, with a strict
Zod schema for each: `queued` (id, time, request and caller ids, trigger,
reason, output hash, the numbers behind the reason), `approved` (id, time,
`by`, optional note) and `rejected` (id, time, `by`, required reason). There is
no state file. An item's status is derived from its events on every read, and a
stream that decides an item twice, decides an unknown item, or decides one
before it was held throws, naming the file. A malformed line throws with
`file:line: field`. Decisions take a short exclusive lock file so two reviewers
cannot both decide one item; enqueueing does not need it (`O_APPEND`).

**5. Every event is also a decision-log line.** A third record kind,
`ReviewRecordSchema` (`kind: "review"`, `event`, `reviewId`, `requestId`,
`actor`, `callerId`, `trigger`, `reason`). It carries the original request id,
so `reliability gateway log --request <id>` shows the chain: the request
answered and held, the hold, the decision. The log line is written first; if it
fails, the event is not written.

**6. Only a named person decides.** `approve` and `reject` refuse a missing or
empty actor, an automated identity (`gateway`, `system`, `auto`, `agent`,
`bot`, ...), and the caller id that made the request. The gateway's only verb
is `enqueue`. There is no HTTP endpoint that approves or rejects; deciding is a
local operator action, `reliability review approve <id> --as <name> [--note]`
or `reject <id> --as <name> --reason <text>`. A test fails if any gateway source
other than the queue calls `approve`.

**7. Max-turn failures reach the queue through the gateway.** The turn bound is
enforced in the agent process, which holds no credentials and should not own
the record. The agent reports the failure over `POST /v1/review`
(`GatewayProvider.requestReview`), and the gateway queues it if its policy
holds max-turn failures. A run with no gateway configured says so and queues
nothing.

**8. Scorecard G, *human oversight*,** computed with `reliability scorecard
--review-queue <file>`. The configured triggers come from the same
`RELIABILITY_REVIEW_*` environment the gateway reads. Strong: every configured
trigger has held an item, at least one item is decided, every decision names a
reviewer and a time, and none was made by software or by the requesting
caller. Adequate: a configured trigger has held nothing yet. At risk: items
held, none decided. Critical: an empty queue, or any automated, self-approved
or unattributed decision. Without the flag it stays stubbed (fillsIn 4D).

**9. A scripted drill.** `scripts/review-drill.ts` holds ten items across the
four triggers on a router-backed gateway with scripted stand-ins for both
tiers, decides all ten through the CLI as two named reviewers, checks that an
automated approver, the requesting caller and a second approval are refused,
and writes `governance/drills/review-queue-<date>.jsonl` and
`review-decisions-<date>.jsonl`. It is sample data and labeled so in
`docs/human-oversight-map.md`.

## Rationale

- **Events, not a state table.** An approval is a fact with a name and a time;
  rewriting a `status` column loses who changed it. Deriving state from the
  stream means the record and the state cannot disagree, and the decision-log
  pattern (ADR 0017) already proved the append-only JSONL shape.
- **Flag, not withhold.** A reviewer has to read the draft. By default the stack
  stores hashes, not text, so withholding the text would leave nothing to
  review unless content capture is on. The caller already receives the draft
  as a draft; the hold tells it not to send.
- **No approve endpoint.** An HTTP verb that releases output would need its own
  authentication (4E) and is the obvious thing for a compromised agent to call.
- **Max turns reported, not observed.** The gateway sees each model call, not
  the loop around them, so the agent is the only process that knows it gave up.

## Degraded canaries

No environment variable disables a safety mechanism (the 4C approach):

- A hand-crafted queue where an item is approved by the requesting caller (or
  by `gateway`) grades G Critical and cites the item.
- A queue with an approval that names no reviewer is malformed: the scorecard
  and `review list` fail loudly with `file:line: by`.

## Consequences

- EU AI Act Art 26 (oversight) returns to `supported`. Residual: the deployer
  must staff the queue, choose the triggers and thresholds, and make its send
  step release only approved items. Art 50 wording matches; OWASP ASI09 and
  NIST MANAGE 4 name the queue.
- **A hold is only as strong as the send step.** The gateway does not stop a
  caller that ignores `review.held`. The reference agent only drafts, so nothing
  is sent; a deployer's integration must check the item's status first.
- **The self-approval check is only as good as the caller id.** Caller ids are
  self-asserted headers until 4E authenticates them; an agent that sends no
  caller id cannot be matched.
- **Pending items do not expire.** There is no response-time timer or backlog
  alarm; the oversight map asks the deployer to name one.
- **Earlier attempts can leave items.** If a held answer fails the agent's
  validator and the agent re-plans, the held item for the rejected attempt
  stays pending; a reviewer rejects it.
- Calibrating `reviewBelow` against real traffic is 4F's work, alongside judge
  calibration.
