# Cycle 15: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**We pulled the kill switch on purpose. Here is the record.**

Last cycle the gateway learned to write down everything it refused. This cycle
it learned to refuse everything, on command, and to prove it.

Rollback was one of the two pillars with no code at all. My own OWASP mapping
said so: "no runtime anomaly detector or kill-switch." The Assessment I sell promises a
kill-switch record, tested and dated. I could not have shown you one.

Now there is one. This is what the drill printed when I ran it:

> Kill-switch drill 2026-10-29 by clarke: PASSED
> time to halt: 143.2 ms (threshold 5000 ms)
> refused probes: 20 of 20
> provider calls after halt: 0
> resume restored: yes
> decision log: 1 halt, 1 resume, 21 kill-switch refusals

The dated record is `governance/drills/kill-switch-2026-10-29.json`. In the
decision log the halt reads as a sentence: "Gateway halted by clarke at ...:
scheduled rollback drill, Phase 4C. No requests served until resume." Every
request it turned away ends "refused by the kill switch (...); no model call
made."

What changed:

**1. One command stops every agent.** `reliability gateway halt --by <name>
--reason <text>` writes a small file. The gateway checks it on every request,
before it touches a model, so a running gateway stops on the next request with
no restart. A broken halt file keeps it stopped. Whoever wrote it meant to stop
something.

**2. The halt is a record.** Who pulled it, why, when, and every request it
turned away, in the same append-only log as every other decision.

**3. Every eval result names its version.** A release manifest rides on each
result and each trace: the commit, a hash of the prompt, the model, each tool
and its arguments, the runtime policy. `reliability release diff` reads two of
them and says what moved: "Prompt hash changed; model unchanged; tool
`lookup_order` added." When the eval gate fails, it now says that too. Rolling
back means knowing what to roll back to.

**4. The scorecard grades the drill.** A new criterion under D, Deployed:
rollback verified. Strong if a drill passed in the last 90 days. At risk once
it goes stale. Critical if it is missing, or if the model was called after the
halt. I wired a deliberately broken drill, one that halts the wrong file, and it
fails the way it should.

What it does not do: decide when to pull the switch. There is no anomaly
detector watching for an agent going wrong. A person pulls it, and the rollback
protocol template says who.

A bank's reviewer asks "can you stop it, and what would you go back to?" Both
answers are now a file with a date on it. Next is the human review queue (4D),
the last pillar with no code. The decision is ADR 0018; the drill record and
sample scorecard are in `governance/drills/` and `content/cycle-15/`.
