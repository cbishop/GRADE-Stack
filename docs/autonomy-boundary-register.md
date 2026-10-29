# Autonomy boundary register

> **Template.** A deployer fills in every `<fill in>` field and keeps this file
> with the deployment, next to `docs/human-oversight-map.md` and
> `docs/rollback-protocol.md`. The manifests (`agents/<id>.json`), the bearer
> tokens and the two chokepoints that enforce them are the stack's mechanisms;
> who owns each agent, which scopes it may touch and who answers when it hits a
> boundary are yours. Phase 4E, ADR 0020.
>
> `reliability scorecard --agents agents --decision-log <file>` reads the first
> column of the table in section 3: every agent with a manifest needs a row, or
> G's *boundary register* criterion says which one is missing.

## 1. Deployment

- **System:** <fill in: the agents behind this gateway and what they are for>
- **Gateway host and environment:** <fill in>
- **MCP server host and transport:** <fill in: HTTP (recommended) or stdio>
- **Manifests directory (`RELIABILITY_AGENTS_DIR`):** <fill in, e.g. `agents/`>
- **Where the tokens file lives, and who can read it:** <fill in>
- **Register last reviewed:** <fill in: date and reviewer>

## 2. The four levels

| Level | Meaning | What the stack enforces |
|---|---|---|
| L0 | Suggest only | No tools: the MCP server refuses every tool call (`tool-not-allowed`). Its responses are suggestions; a person or another system acts on them. |
| L1 | Act with approval | Declared tools only, and every response is held for a named person (`reviewRequired` must be true). The hold does not depend on the agent asking. |
| L2 | Act and notify | Declared tools, models and caps; responses are released. Notifying someone is the deployer's integration, not a stack mechanism. |
| L3 | Autonomous | Declared tools, models and caps; nothing is held. Use only where the kill switch and the decision log are enough. |

At every level: the model allowlist (`agent-model-not-allowed`), the token cap
per request (`agent-token-cap`, never above the gateway-wide cap) and the turn
cap per session (`agent-turn-cap`) are enforced at the gateway; a missing,
unknown or contradicted bearer token is 401 at both chokepoints. Each refusal
is a decision-log line naming the agent, the limit and the time.

## 3. Register

One row per agent. **Scopes** are the data the agent's tools can reach (the
stack scopes by tool, not by record). The **handoff rule** says what happens
when the agent hits a boundary or a hold; the **escalation owner** is the named
person who answers for it.

| Agent | Level | Tools | Models | Limits | Scopes | Handoff rule | Escalation owner |
|---|---|---|---|---|---|---|---|
| `triage` | L1 act with approval | `lookup_account`, `search_help_articles` | `stub-deterministic` (CI), `gemma4`, `claude-haiku-4-5` | 5 turns per session, 800 tokens per request | Any customer account by sender email (read only); the public help centre | Every draft is held in the review queue; nothing is sent until a named reviewer approves it (`docs/human-oversight-map.md`). A refused tool or model call ends the run with the refusal; the reviewer sees no draft. | <fill in: named person> |
| `helpdesk` | L0 suggest only | none | `gemma4` | 1 turn per session, 200 tokens per request | None | Suggests a help-article title to a support person, who decides. **Sample data:** the second agent in the cycle-17 demo (`content/cycle-17/agents/helpdesk.json`); delete this row if you do not run it. | kb-team (sample) |
| `<fill in>` | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> | <fill in> |

`reliability agents list` prints the same facts from the manifests, so this
table and the enforced boundary can be compared line by line.

## 4. Out-of-scope boundaries (stated, not silent)

- **Agent-to-agent protocol.** No agent calls another agent, and the stack has
  no agent-to-agent channel, delegation or "act on behalf of" identity. If one
  agent's output becomes another's input, it goes through a person or your own
  integration, and each agent still authenticates as itself. Adding an
  agent-to-agent channel makes OWASP ASI07 a scored obligation: it needs
  authenticated, integrity-protected messages and its own row here.
- **Per-record scope.** A tool is allowed or not; the stack does not limit
  which accounts `lookup_account` may read. Narrow the tool, or put the check
  in the tool's backing system.
- **Holding tool calls.** L1 holds an agent's responses, not its tool calls.
  The reference tools only read; give an L1 agent a tool that changes
  something only if the tool itself waits for approval.
- **Token lifecycle.** Tokens are static shared secrets: no expiry, rotation
  or revocation list. Rotate by issuing a new tokens file and restarting both
  chokepoints. Name who does that: <fill in>.
- **Stdio MCP.** A stdio MCP server is the agent's own child process and shares
  its trust domain. The boundary is real only when the MCP server runs as its
  own process over HTTP with its own tokens file.

## 5. Evidence

- Manifests: `agents/triage.json` (and any others in `RELIABILITY_AGENTS_DIR`).
- Enforcement: `reliability gateway log --caller <agent>` (401s, manifest
  refusals, held responses, tool calls allowed and refused).
- Grade: `reliability scorecard --agents agents --decision-log <file>`: A's
  three boundary criteria and G's boundary register.
- Sample run: `content/cycle-17/sample-decision-log.jsonl` against
  `content/cycle-17/agents/`, graded in `content/cycle-17/sample-scorecard.md`.
