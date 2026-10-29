# Human oversight map

> **Template.** A deployer fills in every `<fill in>` field and keeps this file
> with the deployment, next to `docs/logging-and-retention.md` and
> `docs/rollback-protocol.md`. The review queue, its triggers and the record
> of who decided are the stack's mechanisms; who reviews, how fast, and what
> your send step does with a held draft are yours. Phase 4D, ADR 0019.

## 1. Deployment

- **System:** <fill in: agent name and purpose>
- **Gateway host and environment:** <fill in>
- **Owner of the review queue (accountable person):** <fill in>
- **Map last reviewed:** <fill in: date and reviewer>

## 2. The three routes

Every request through the gateway takes the first route that settles it:

1. **Local.** The confidence router samples the local model; if its answers
   agree at or above the router threshold, the local answer is served.
2. **Frontier.** Otherwise the request escalates to the frontier model.
3. **A person.** If the local agreement was below the review threshold
   (`reviewBelow`) even though the frontier answered, the answer is held for a
   named person. So is any answer that trips another trigger in section 3.

A held answer is returned to the caller with `review: { held: true, id, reason }`
and is not to be released until a named person approves it. The gateway flags
the hold; **your send step must check it** (section 6).

## 3. Triggers

| Trigger | Holds an answer when | Setting | Stack default | This deployment |
|---|---|---|---|---|
| `low-confidence` | the router escalated and local agreement was below `reviewBelow` | `RELIABILITY_REVIEW_BELOW` (0..1, or `off`) | off | <fill in, e.g. 0.60> |
| `max-turns` | the agent hit its turn bound without a valid answer | `RELIABILITY_REVIEW_ON_MAX_TURNS` | on | <fill in> |
| `output-redaction` | the PII guardrail redacted the answer | `RELIABILITY_REVIEW_ON_REDACTION` | off | <fill in> |
| `requested` | the request set `requiresReview`, or the agent's manifest requires review (every L1 agent, Phase 4E; held even when the env switch is off) | `RELIABILITY_REVIEW_ON_REQUEST` | on | <fill in> |

- **Router threshold in this deployment:** <fill in, `RELIABILITY_ROUTER_THRESHOLD`>
- **Why this review threshold:** <fill in: what share of traffic it holds, and who agreed to that load>
- **Queue file:** <fill in, `RELIABILITY_REVIEW_QUEUE`, default `./review-queue.jsonl`>

## 4. Who reviews what

| Trigger | Reviewer role | Names | Can approve | Can reject | Respond within |
|---|---|---|---|---|---|
| `low-confidence` | <fill in, e.g. support lead> | <fill in> | yes | yes | <fill in> |
| `max-turns` | <fill in> | <fill in> | <fill in> | yes | <fill in> |
| `output-redaction` | <fill in, e.g. privacy or risk officer> | <fill in> | <fill in> | yes | <fill in> |
| `requested` | <fill in> | <fill in> | <fill in> | yes | <fill in> |

Reviewers must be competent for what they review and able to say no (EU AI Act
Art 26 asks for both). The stack refuses a decision by an automated identity
(`gateway`, `system`, `auto`, `agent`, `bot`, ...) or by the caller id that
made the request, and refuses a second decision on any item. It cannot check
that a name belongs to a competent person: that is this table.

- **Who can write to the queue file (the real access list):** <fill in>

## 5. Escalation owner

- **Owner of pending items:** <fill in: who chases an item nobody has decided>
- **What happens when an item waits longer than the response time:** <fill in>
- **Backlog alarm:** <fill in, e.g. a cron job on `reliability review list --pending --json`; the stack has no timer>
- **When reviewers disagree, or nobody is available:** <fill in>

## 6. Deciding, and releasing

```bash
reliability review list --pending                    # one line per held item
reliability review show <id>                         # why it was held, the output hash, the decision so far
reliability review approve <id> --as <your-name> --note "<why it is fine>"
reliability review reject <id> --as <your-name> --reason "<why not>"
reliability gateway log --request <request id>       # the chain: answered and held, held, decided
```

Each decision is appended to the queue with the reviewer's name and the time,
and written to the decision log. The queue is append-only: a decision cannot be
edited or undone, only made once.

- **How your send step checks an item before releasing it:** <fill in, e.g. `reliability review show <id> --json` and release only when `status` is `approved`>
- **What the customer sees while an item is held:** <fill in>
- **What happens to a rejected draft:** <fill in>

## 7. Records and retention

- **Queue file location and backup:** <fill in>
- **Retention:** <fill in; keep it at least as long as the decision log (see `docs/logging-and-retention.md`)>
- **Grading:** `reliability scorecard --review-queue <file>` computes G's *Human
  oversight record*: Strong when every configured trigger has held an item,
  items are decided, every decision names a reviewer and a time, and none was
  automated or self-approved. Run it with the gateway's `RELIABILITY_REVIEW_*`
  settings so it knows which triggers are configured.

## 8. Sample approval log

> **SAMPLE DATA.** Produced by `bun scripts/review-drill.ts` on 2026-10-29 in
> this repo: a router-backed gateway with scripted stand-ins for the local and
> frontier tiers (no model was called), every trigger on, `reviewBelow` 0.60.
> `support-lead` and `risk-officer` are role names used by the drill, not real
> reviewers. The drill also confirmed that an approval by `gateway`, an approval
> by the requesting caller `triage`, and a second approval of an approved item
> were all refused. Records: `governance/drills/review-queue-2026-10-29.jsonl`
> and `governance/drills/review-decisions-2026-10-29.jsonl`.

| # | Item | Trigger | Held | Why held | Decision | By | At | Note or reason |
|---|---|---|---|---|---|---|---|---|
| 1 | `rv-1bcb348ea513` | low-confidence | 2026-10-29 19:24:29 UTC | confidence 0.40 below the review threshold 0.60 after frontier escalation to bedrock | approved | support-lead | 2026-10-29 19:24:30 UTC | frontier answer matches the invoice history |
| 2 | `rv-352f7bbadc61` | low-confidence | 2026-10-29 19:24:29 UTC | confidence 0.20 below the review threshold 0.60 after frontier escalation to bedrock | rejected | support-lead | 2026-10-29 19:24:30 UTC | ambiguous request; asked the customer which issue comes first |
| 3 | `rv-174e859d309d` | low-confidence | 2026-10-29 19:24:29 UTC | confidence 0.40 below the review threshold 0.60 after frontier escalation to bedrock | approved | support-lead | 2026-10-29 19:24:30 UTC | late fee is real; draft explains the waiver process |
| 4 | `rv-23a7eebadf86` | max-turns | 2026-10-29 19:24:29 UTC | the agent did not converge within its turn bound of 3; last validation issues: category: invalid enum value 'refund' | rejected | risk-officer | 2026-10-29 19:24:30 UTC | agent could not classify; handled manually |
| 5 | `rv-1062860d95e3` | max-turns | 2026-10-29 19:24:29 UTC | the agent did not converge within its turn bound of 3; last validation issues: draft_reply: required; priority: invalid enum value 'p1' | rejected | risk-officer | 2026-10-29 19:24:31 UTC | no usable draft after three turns; routed to tier 2 |
| 6 | `rv-3c054ab5cbfa` | output-redaction | 2026-10-29 19:24:29 UTC | the output had SSN redacted; the policy holds redacted outputs for review | approved | risk-officer | 2026-10-29 19:24:31 UTC | SSN redacted before return; draft is safe to send |
| 7 | `rv-b941e2bef986` | output-redaction | 2026-10-29 19:24:29 UTC | the output had credit-card number redacted; the policy holds redacted outputs for review | approved | support-lead | 2026-10-29 19:24:31 UTC | card number redacted; duplicate charge confirmed |
| 8 | `rv-68a7e050b5c1` | requested | 2026-10-29 19:24:29 UTC | the request asked for human review (requiresReview) | approved | risk-officer | 2026-10-29 19:24:31 UTC | cancellation terms quoted correctly |
| 9 | `rv-2fc243c7913c` | requested | 2026-10-29 19:24:29 UTC | the request asked for human review (requiresReview) | approved | risk-officer | 2026-10-29 19:24:31 UTC | fee dispute acknowledged without admitting liability |
| 10 | `rv-61884238b3d7` | requested | 2026-10-29 19:24:29 UTC | the request asked for human review (requiresReview) | approved | support-lead | 2026-10-29 19:24:31 UTC | credit confirmed in billing before sending |

Graded with `RELIABILITY_REVIEW_BELOW=0.6 RELIABILITY_REVIEW_ON_REDACTION=1
reliability scorecard --review-queue governance/drills/review-queue-2026-10-29.jsonl`:
Human oversight record, Strong (four triggers configured, each held at least one
item; ten decided, each by name and time; zero auto-approvals).

**This deployment's approval log:** <fill in: the queue file, and the date of the
last review of a sample of decisions>
