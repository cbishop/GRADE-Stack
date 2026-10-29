# Cycle 16: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**The router's third route is a person.**

Until this cycle my confidence router had two places to send a question. If the
cheap local model agreed with itself, it answered. If not, the question went up
to the frontier model. That is a good cost policy. It is also a quiet one: when
the local model could not make up its mind, the frontier answer went out and
nobody looked at it.

The EU AI Act asks a high-risk deployer for human oversight by competent
people. My own mapping said the stack could not show any. I had marked it down
to partial in Phase 4A and written "until Phase 4D ships the review queue."

This is 4D. The router now has a third route, and it is a named human.

What changed:

**1. Some answers are held.** The gateway holds an answer for a person when the
local model's agreement stays below a review threshold even after the frontier
answered, when the agent hits its turn limit without a valid answer, when the
privacy guardrail had to redact something (if you switch that on), or when the
request asks for review. The answer comes back flagged, with a reason a manager
can read: "confidence 0.40 below the review threshold 0.60 after frontier
escalation to bedrock."

**2. Only a person can release it.** `reliability review approve <id> --as
<name>` or `reject --as <name> --reason <text>`. No name, no decision. The
gateway cannot approve. The agent that asked cannot approve its own answer.
Nothing approves twice. There is no web endpoint for it at all.

**3. Every decision is a record.** Held, approved, rejected: each is a line in
an append-only file and in the gateway's decision log, with who and when. Ask
the log about one request and you get the chain: answered, held, approved by
support-lead at 19:24.

**4. The scorecard grades it.** G, Governed, gains a computed criterion: human
oversight. Strong only if every trigger you switched on has actually held
something, every decision has a name and a time, and none was made by
software. I fed it a file where the agent approved itself. It went Critical.

I ran a drill: ten held items across all four triggers, decided by two
reviewers, with the refusals checked. The sample approval log is in the new
oversight map. The scorecard moved from At risk to Adequate overall, because
G's weak spot is closed.

What it does not do: staff the queue. The gateway flags a held draft; your send
step has to respect the flag, and someone competent has to be on the other end
with the authority to say no. The template asks who, and how fast.

A bank's model-risk reviewer asks "who looks at the answers the machine was
unsure of, and can you show me?" That is now a file with names and times in it.
Next is 4E: telling two agents apart and giving each its own limits. The
decision is ADR 0019; the drill record, the oversight map and the sample
scorecard are in `governance/drills/`, `docs/human-oversight-map.md` and
`content/cycle-16/`.
