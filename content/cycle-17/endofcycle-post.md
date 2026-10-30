# Cycle 17: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**L0 to L3: say how much your agent may do, then prove it did no more.**

Until this cycle my gateway could not tell two agents apart. Every request
carried a caller name the agent typed itself, and the log marked it
"unverified". The review queue's rule that an agent cannot approve its own work
had a hole: the agent I actually run sent no name at all.

A bank's vendor-risk reviewer asks two questions about any AI agent. What is it
allowed to do? And how do you know it did nothing else? This is Phase 4E, and
it answers both with files.

What changed:

**1. Every agent has a manifest.** One small JSON file per agent: who owns it,
its autonomy level, which tools and models it may use, how many model calls it
gets per run, and how many tokens per call. Four levels: L0 suggests only, L1
acts with approval, L2 acts and tells someone, L3 is autonomous. An L0 agent
cannot list a tool, and an L1 agent cannot switch review off.

**2. Agents prove who they are.** Each agent gets a secret token. No token, a
wrong token, or a name that disagrees with the token gets a 401 and a line in
the log. The token is never written down. The name in the log now comes from
the token, so it says "verified".

**3. Two places enforce the limits.** The gateway sees model calls, so it
enforces models, token caps, turn caps and review. It cannot see tool calls, so
the tool server enforces tools, where they run. Both read the same manifests and
write to the same log.

**4. L1 means held.** My triage agent is L1. Every draft it writes is held for
a named person, whether or not the agent asks. The agent cannot release its own
work, and now that it has a verified name, it cannot approve it either. I tried.

**5. The scorecard grades declared against observed.** The A letter, Agentic,
finally has real criteria. Every tool that ran was declared. No call exceeded
its level: the L0 agent ran zero tools and every L1 answer was held. Every
record carries an authenticated caller.

I ran it on my local model with two agents. The L1 triage agent looked up an
account and its draft was held. The L0 helpdesk agent suggested an article,
then tried to look up an account. The tool server refused it before the tool
ran. It asked for 800 tokens against a cap of 200 and was refused. It claimed
to be the triage agent and got a 401. A wrong token got a 401. Ten lines in the
log, each one a sentence.

The scorecard gave A an Adequate: nothing undeclared ran, but an agent tried.
I added one line to a copy of the log where the L0 agent's tool call ran
anyway. A went Critical and named the record.

What it does not do: rotate tokens, limit which accounts a tool may read, or
hold a tool call (L1 holds the answer; my tools only read). Agents talking to
other agents is out of scope, and the new boundary register says so in writing
instead of leaving it silent.

Next is 4F: proving the eval suite itself can be trusted. The decision is ADR
0020; the boundary register, the sample log and the sample scorecard are in
`docs/autonomy-boundary-register.md` and `content/cycle-17/`.
