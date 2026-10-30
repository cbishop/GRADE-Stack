# ADR 0020: Agent manifests, bearer tokens, and two-chokepoint enforcement

- **Status:** Accepted
- **Date:** 2026-10-29
- **Phase:** 4E (boundaries: per-agent manifest, caller authentication, and the Agentic dimension)

## Context

The gateway could not tell two agents apart. The caller id was a
self-asserted `x-caller-id` header, logged as unverified (ADR 0017), so the
4B scorecard capped *attributable* at Adequate and the 4D self-approval check
(ADR 0019) could not match an agent that sent no header, which `agent run` did
not. Limits were gateway-wide: one model allowlist, one token cap, and a turn
bound enforced only inside the agent process. Nothing declared what a given
agent was allowed to do, so the A letter had no way to compare declared
autonomy with observed behaviour. The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`, row 5) lists all of this,
and OWASP ASI02 and ASI03 said the stack had no per-tool authorization and no
per-agent identity.

## Decision

**1. A manifest per agent.** `agents/<id>.json`, a strict Zod schema
(`packages/gateway/src/agent-manifest.ts`): `id`, `owner`, `autonomyLevel`,
`allowedTools`, `allowedModels`, `maxTurns`, `tokenCap`, `reviewRequired`, and
an optional `description`. The levels are `L0` suggest only, `L1` act with
approval, `L2` act and notify, `L3` autonomous. The schema enforces two level
rules: an L0 agent declares no tools, and an L1 agent must set
`reviewRequired: true`. A file must be named for its id, `anonymous` is
reserved, and unknown keys are refused. A malformed manifest, a missing
directory, or two files with one id throw at start with `file: field:
message`; a broken boundary never reads as "no boundary". The reference agent
is `agents/triage.json` at L1.

**2. Bearer tokens, opt in by directory.** `RELIABILITY_AGENTS_DIR` switches
manifests on. Tokens come from `RELIABILITY_AGENT_TOKENS` (`id:token,...`), else
the file `RELIABILITY_AGENT_TOKENS_FILE`, else `./.reliability-agent-tokens`
when present (git-ignored). A token is at least 16 characters; a token for an
agent with no manifest, or manifests with no tokens at all, refuse to start.
Tokens are compared as SHA-256 digests with `timingSafeEqual`, against every
stored token, and never appear in an error message or a log line. The agent
sends its own token from `RELIABILITY_AGENT_TOKEN`; `createProvider` puts it on
the `GatewayProvider`.

**3. The token decides who is calling.** With manifests, every request to
`/v1/generate` and `/v1/review` needs `authorization: Bearer <token>` for a
known agent. A missing, malformed or unknown token, or an `x-caller-id` (header
or body) that disagrees with the token, is refused with 401, a structured
`caller-auth` violation, and one `auth` decision-log line naming the
chokepoint, the reason and any claimed caller id (as untrusted). We refuse the
disagreeing header rather than ignore it: a request that claims to be someone
else is a fact worth a log line. Records from a token carry
`callerVerified: true`. Without manifests nothing changes from v2: no token is
needed, `x-caller-id` is logged as unverified, and a request with no caller id
is logged as `anonymous` (degraded mode still drops it to null, the D canary).

**4. The gateway enforces the manifest per request.** The request runs under
`manifestPolicy(DEFAULT_POLICY, manifest)`: the agent's model allowlist, and a
token cap that is the smaller of the manifest's and the gateway's, so a
manifest can narrow the gateway's limits but never widen them. A request
without `maxTokens` is given the cap. The turn cap counts model calls per
session (`x-session-id`); `GatewayProvider` carries a session id and the
reference agent opens a fresh one per run (`withSession`), so the cap bounds a
run. A manifest-bound call without a session is refused, because it cannot be
counted. Refusals are named for the manifest so the log tells them from
gateway-wide limits: `agent-model-not-allowed`, `agent-token-cap`,
`agent-turn-cap`. An agent whose manifest requires review has every response
held (trigger `requested`, reason naming the level), regardless of
`RELIABILITY_REVIEW_ON_REQUEST`: switching off the request flag must not
release an L1 agent's actions.

**5. Two chokepoints: tools are enforced where they run.** The gateway sees
model calls, not tool calls, so the MCP server is the second chokepoint. It
loads the same manifests and tokens. Over HTTP it authenticates the bearer
token on every request (401 and an `auth` line otherwise); over stdio the
agent that spawns it passes `RELIABILITY_AGENT_TOKEN`, and a bad token refuses
every tool call. Each tool call is checked before its handler runs: an
undeclared tool, or any tool from an L0 agent, returns an MCP tool error
`tool-not-allowed: <reason>` and the tool's data is never read. Every check,
allowed or refused, writes one `tool` line with the verified caller id, the
level, the tool and a hash of the arguments. The MCP server imports only the
gateway package's `agent-manifest` and `decision-log` modules (new subpath
exports), never the credentialed service.

**6. Readback.** `reliability agents list` and `agents show <id>` print each
agent's level, owner, tools, models and limits in plain language, and `--json`.
`reliability gateway log` explains the new lines: "Request demo-wrong-token at
... refused at the gateway with 401 by policy caller-auth: unknown bearer
token ...; nothing ran." and "Tool call ... from agent helpdesk (verified, L0)
...: lookup_account refused at the MCP server by policy tool-not-allowed ...;
the tool did not run."

**7. Scorecard A computed** with `reliability scorecard --agents <dir>
--decision-log <file>` (A needs the log; `--agents` alone fails):

| Criterion | Strong | Adequate | Critical |
|---|---|---|---|
| *Every observed tool is declared* | tool calls observed, every one that ran declared | nothing undeclared ran, but none observed or one was refused | an undeclared tool ran |
| *No call exceeded the declared level* | calls observed, L0 ran no tool, every review-required response held, nothing refused | the same with refused attempts, or nothing observed | an L0 tool call ran, or an L1 response was released unheld |
| *Every record carries an authenticated caller* | 100% of request and tool lines verified | at least 90% | below 50%, or empty (At risk at least 50%) |

Each cites the manifest files, the log and the flagged record ids. G's
*boundary register* is computed too: every manifest names a real owner (not a
template placeholder) and has a row in `docs/autonomy-boundary-register.md`.
D's *attributable* reaches Strong once every caller is verified; `anonymous`
counts as no caller.

## Rationale

- **Two chokepoints, not one.** Moving tool calls through the gateway would
  give it a provider-native tool-use seam that ADR 0006 deliberately kept out.
  The MCP server is already where tools run, so that is where they are refused.
- **Opt-in directory.** Requiring manifests always would break every v2
  quickstart and demo. Leaving them off is visible: the scorecard's
  *authenticated caller* criterion goes Critical, which is the mechanism.
- **Static tokens.** A shared secret per agent is the smallest thing that
  turns a claimed identity into a checked one, needs no infrastructure, and is
  enough for a single deployment. Rotation, expiry and mTLS are a deployment's
  next step.
- **Hold by manifest, not by request.** If an L1 agent had to ask for review,
  a buggy or compromised agent could stop asking.

## Degraded canaries

No environment variable disables a safety mechanism (the 4C and 4D approach):

- A decision log with an undeclared tool call that ran (a hand-crafted `tool`
  line, action allow) drops A to Critical and cites the record; if the agent is
  L0, *no call exceeded the declared level* goes Critical too. The smoke test
  does this against the built binary.
- A gateway run without `RELIABILITY_AGENTS_DIR` logs unverified or anonymous
  callers, and *every record carries an authenticated caller* goes Critical.

## Consequences

- Closes the 4B residual (ADR 0017): with manifests, caller ids are verified.
- Closes the 4D residual (ADR 0019): `agent run` is authenticated, the review
  item records the agent, and `review approve --as triage` is refused as the
  requesting caller. `requiresReview` for L1 agents is set by the manifest.
- OWASP ASI03 adds per-agent identity at both chokepoints; ASI02 adds per-agent
  tool scope and stays `partial` (no per-argument scope, rate limit or
  side-effect sandbox).
- **Turn caps count sessions the agent names.** An agent that opens a new
  session for every call is not bounded per run; the cap bounds a session, and
  the agent-side `MaxTurnsError` still bounds the reference agent's loop.
- **Every L1 response is held, including intermediate ones.** The reference
  agent's tool-selection call is held as well as its draft; a reviewer rejects
  or approves the selection item. Holding only final answers would need the
  agent to say which call is final, which is the trust this design avoids.
- **L1 holds responses, not tool calls.** The reference tools only read. A
  mutating tool on an L1 agent needs its own approval step.
- **Stdio shares the agent's trust domain.** A stdio MCP server is the agent's
  child; a compromised agent could start it unguarded. HTTP with its own tokens
  file is the real boundary.
- **No agent-to-agent protocol.** Out of scope, stated in the boundary register;
  ASI07 stays out of scope until a deployment adds such a channel.
- **Stdio from the built binary is a known gap.** `agent run --mcp` from the
  bundled CLI cannot spawn the stdio server: the bundled path to the server's
  `bin.ts` does not exist (found while writing this phase; it predates 4E).
  With `RELIABILITY_MCP_URL` the agent reaches an HTTP server instead, which the
  smoke test exercises. Fixing the stdio spawn from the bundle is a follow-up.
