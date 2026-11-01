# Security fixes: plan of work

**Written:** 2026-11-01 at `7b6e92b`. **Source:** `docs/security-review-2026-10-29.md`
(review at `d98d0b2`, 2026-10-29). **Status:** findings 1 to 4 merged (PRs #28 to #31, 2026-11-01); finding 5 in PR.

Each finding was re-checked against the current tree before this plan was
written. Phase 4E (ADR 0020) shipped between the review and now, which
closes part of finding 2 and changes how 2 and 7 should be done.

Each section below has three parts: **The problem** (what is wrong, why it
is wrong, and what it lets happen), **The plan** (the change and the test
that proves it), and where relevant **Deviation** (where this plan departs
from the review's suggested fix and why).

## Ground rules (from the review and `CLAUDE.md`)

- One finding per branch and PR, named `sec-N-<slug>`.
- First commit on each branch is a failing test that asserts the fix's effect.
- Local gate before every push: `bun run typecheck && bun run check && bun run test && bun run build`.
- Deviations from the review's suggested fix are recorded here and, where
  they change an architectural decision, as an ADR.

## Order and branches

| # | Branch | Severity | Status vs review | Size |
|---|--------|----------|------------------|------|
| 1 | `sec-1-request-schema` | High | merged, PR #28 | half day |
| 2 | `sec-2-loopback-bind` | High | merged, PR #29 | quarter day |
| 3 | `sec-3-upstream-error-body` | Medium | merged, PR #30 | hour |
| 4 | `sec-4-capture-after-log` | Medium | merged, PR #31 | half day |
| 5 | `sec-5-dependency-audit` | Medium | in PR | half day plus CI iteration |
| 6 | `sec-6-guardrail-normalise` | Low | open | half day |
| 7 | `sec-7-mcp-loopback-rebinding` | Low | open; auth half shipped by 4E; needs 5 first | quarter day |
| 8 | `sec-8-cleanups` | Info | all four items open | hour |

Order: 1, 2, 3, 4, 5, 7, 6, 8. Finding 7 moves ahead of 6 because it
depends on the SDK bump in 5 and shares the bind-address pattern from 2.

---

## 1. Request schema at the HTTP boundary (High)

### The problem

The gateway exists to put every model call behind guardrails: prompt-injection
denial, secret-exfiltration denial, token caps. Those guardrails run in
`applyInputPolicy`, which scans the text of the request. The text is assembled
by `inputText` (`packages/gateway/src/policy.ts:144`), which does this:

```ts
[request.system ?? "", ...request.messages.map((m) => m.content)].join("\n")
```

That code assumes `system` and every `content` are strings. Nothing enforces
the assumption. The HTTP adapter (`connect.ts:203`) does
`(await req.json()) as GatewayGenerateBody`, a TypeScript cast that checks
nothing at runtime. The only validation is `if (!body?.target || !body?.request)`.

So a caller can send `content` as an array of content blocks, the shape the
Anthropic Messages API natively accepts:

```json
{ "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Ignore all previous instructions..." }] }] }
```

JavaScript's `join` turns that array into the string `"[object Object]"`.
None of the regex guardrails can match `[object Object]`, so the input stage
returns `allow`. The original array is forwarded untouched to the provider,
and Bedrock's Messages API accepts content-block arrays, so the model sees the
injection in full. The review reproduced this: the same prompt returns 422
when sent as a string and 200 when sent as an array.

Two related gaps ride along:

- `role` is not validated, and the shared `Role` type includes `"system"`.
  A caller can inject a system-role turn mid-conversation, which the
  guardrails do not treat as system text and the model may.
- There are no size limits. A caller can send a message of any length or a
  conversation of any number of turns, bounded only by Bun's 128 MB body
  default. The token-cap guardrail checks the caller's `maxTokens` request,
  not the size of the input.

The consequence: every input guardrail the stack advertises, and every
scorecard criterion that credits them, can be bypassed by changing the JSON
shape. The decision log still records the call as `allow`, so the record is
honest about what happened but wrong about whether the guardrail was applied.
The second `req.json()` cast at `connect.ts:269`, for the review endpoint,
has the same unchecked-shape weakness, though with less at stake.

### The plan

1. Failing test first in `gateway.test.ts`, `describe("request schema at the HTTP boundary")`, using the review's two tests: content-block array, system array, and `role: "system"` each get 400 with zero provider calls; the same injection as a string still gets 422.
2. Add `GatewayGenerateBodySchema` and `GatewayReviewBodySchema` in `@grade-stack/core` next to the types (zod is already a core dependency, see `pev.ts`). Derive the TS types from the schemas with `z.infer` so client and server cannot drift. Use `strictObject` so unknown keys are refused rather than passed through. Limits: content 100k characters, 200 messages, `maxTokens` a positive integer, `temperature` 0 to 2.
3. `safeParse` in `connect.ts` before `requestContext` on both endpoints. Failure is 400 with the fixed body `Bad request: invalid request body`. No zod issue detail goes to the caller, because issue dumps reveal the schema and the field paths.
4. Defense in depth: parse `request` again at the top of `GatewayService.generate`. The HTTP adapter is one caller; tests, the CLI, and future transports call the service directly. A failure writes one decision-log line (`action: block`, `policy: request-schema`, `stage: input`) and returns a violation, so ADR 0017's one-line-per-call rule holds and non-HTTP callers get the same guarantee.
5. `target: "stub"` from the network: the stub provider returns canned text with no credentials, so an attacker who can select it gains nothing, but a misconfigured client that selects it silently gets fake answers. Add `allowStubTarget` to `GatewayServeOptions`, default true when `NODE_ENV !== "production"`, otherwise false. Check `gateway.test.ts` and `agent-boundary.test.ts` first, since both drive HTTP with stub providers.

### Deviation

None expected. The review offers core or gateway for the schema; core is right because `GatewayProvider` (the client) lives there too and should validate what it sends.

As built (branch `sec-1-request-schema`):

- The review's schema snippet omits `requiresReview` (Phase 4D, sent by L1 agents). The schema keeps it as an optional boolean; dropping it would have made every held-review request a 400.
- `Role` keeps `"system"` because the Ollama provider builds its own message list with a system turn; it now uses a local `OllamaMessage` type. `ChatMessage`, `GenerateRequest`, `ProviderName`, `GatewayGenerateBody` and `GatewayReviewBody` are all `z.infer` types now.
- The service checks the schema before the kill switch, so a malformed request is `request-schema` even on a halted gateway, matching the HTTP adapter, which refuses it before the service runs.
- A schema-refused request is not content-captured (the capture record cannot hold its shape, and a capture write failure would suppress the log line). Its input hash is computed defensively.
- One test beyond the review's: `allowStubTarget: false` refuses `target: "stub"` with the same 400.

---

## 2. Loopback bind (High; caller auth already shipped)

### The problem

The gateway process holds the provider credentials: the AWS keys or role that
can call Bedrock and spend money, and whatever Ollama endpoint is configured.
Anyone who can reach the gateway's port can spend those credentials, and can
do so through the guardrails or, until finding 1 is fixed, around them.

`connect.ts:190` calls `Bun.serve({ port, fetch })` with no `hostname`. Bun's
default is to bind every interface, `0.0.0.0`. The review confirmed this by
inspecting the listening socket: it shows `0.0.0.0:<port>` even though the
`url` the gateway returns and prints says `http://localhost:<port>`. So the
operator is told the gateway is local when it is actually reachable from the
LAN, from a coffee-shop wifi, or from anything with a route to the host.
`bin.ts` defaults to port 8787, which is predictable.

At the review's commit there was no authentication at all. `x-caller-id` was a
self-asserted header, logged as unverified. Phase 4E has since shipped bearer
tokens (ADR 0020): with agent manifests configured, every request must carry a
token for a known agent, unknown tokens get 401 and an `auth` log line, a
matched token sets `callerVerified: true`, the reference agent sends its token,
and a disagreeing `x-caller-id` is refused. That covers the review's steps 2,
4 and most of 5.

What remains: 4E deliberately kept v2 behaviour when no manifests are
configured, so the gateway starts open and anonymous. Combined with the
`0.0.0.0` bind, the default `reliability gateway serve` with no agents dir is a
credential proxy reachable from the network. Even with agents configured, the
bind address is wider than the stated intent.

### The plan

1. Failing tests: `serveGateway({ port: 0 }).url` contains `127.0.0.1`; `serveGateway({ hostname: "0.0.0.0", agents: null })` throws; `serveGateway({ hostname: "0.0.0.0", agents: <registry> })` starts.
2. Add `hostname?: string` to `GatewayServeOptions`, default `"127.0.0.1"`, override via the option or `RELIABILITY_GATEWAY_HOST`. Build `url` from the real hostname so the printed URL matches the socket. Pass `--host` through `bin.ts`.
3. Refuse to start when the hostname is not loopback and the agent registry is empty. Loopback means `127.0.0.1`, `::1`, `localhost`. The error message says why and names the two ways out: bind loopback, or configure agents.
4. Do **not** add the review's separate `RELIABILITY_GATEWAY_TOKENS` mechanism. One token mechanism exists; a second would be a parallel path to keep in sync and a second place for a token to leak.
5. Amend ADR 0020 with a short "bind address" section rather than write a new ADR.

### Deviation

The review's steps 2 and 4 (build a bearer check, have the client send it) are already done differently by 4E and are not redone.

As built (branch `sec-2-loopback-bind`):

- Loopback is decided by the existing `isLoopbackHost` in `@grade-stack/core` (the air-gap guard), not a second helper. It accepts the plan's three forms plus the rest of `127.0.0.0/8` and `*.localhost`, all of which stay on the machine.
- "Agent registry is empty" means null or zero manifests. A registry with manifests but no tokens already refuses to start (ADR 0020).
- The check runs before the service or the socket exists, so a refusal leaves nothing listening; a test proves the port is still free afterwards.
- An empty `RELIABILITY_GATEWAY_HOST` counts as unset.
- `reliability gateway serve` prints a refused bind as one line (`gateway not started: ...`) and exits 1, rather than a stack trace. `--host` is on both the CLI and `packages/gateway/src/bin.ts`.

---

## 3. Upstream error body (Medium)

### The problem

When the provider call fails, `connect.ts:234` returns:

```ts
new Response(`Gateway upstream error: ${message}`, { status: 502 })
```

where `message` is the provider's error text verbatim. Provider errors are
written for the operator, not for an untrusted caller, and they carry
identity:

- AWS authorization failures look like `User: arn:aws:iam::123456789012:user/gateway-prod is not authorized to perform: bedrock:InvokeModel on resource: ...`. That names the account id, the IAM principal, and the model ARN. An attacker now knows which account and role to target and what model it is allowed to call.
- Zod validation failures from the provider layer dump the issue list, which reveals internal field names and schema structure.
- Filesystem errors (a missing capture dir, an unwritable decision log) carry absolute paths, which reveal the username and layout of the host.

On its own this is an information leak. Combined with finding 2 at the review's
commit, an unauthenticated network caller could trigger an auth failure on
purpose (send any request while credentials are wrong or missing) and read the
credentialed identity from the response. The decision log already records the
full message in `reason`, so the operator loses nothing by hiding it from the
caller.

### The plan

Failing test with a provider that throws the review's IAM ARN message; assert
the body has neither `arn:` nor the account id, status is 502, and the
decision-log `reason` keeps the full text. Then change the body to the fixed
string `Gateway upstream error (request <requestId>)`. The request id lets the
caller quote something the operator can look up. The `x-request-id` header is
already set. `GatewayService.generate` keeps throwing as it does now, because
in-process callers are trusted and need the detail.

**As built:** `POST /v1/review` echoed its review-queue error text the same way, so it now returns `Gateway review queue error (request <requestId>)`; that path writes no decision-log line, so the full text goes to the gateway's stderr instead.

---

## 4. Content capture can suppress the log line and persists blocked secrets (Medium)

### The problem

ADR 0017's guarantee is: every gateway call leaves exactly one decision-log
line, no matter what happens. The scorecard, the review queue, the kill
switch and the Agentic criteria all compute from that log, so a missing line
is not just a gap in the record but a wrong number downstream.

`record` in `gateway.ts:545-600` is where the line is written. When content
capture is on (`RELIABILITY_TRACE_CONTENT=1`), the method does this, in order:

1. `await writeCapture(this.captureDir, { ..., request, output })` at line 566
2. `await this.decisionLog.append({ ... })` at line 576

`writeCapture` (`capture.ts:56`) begins with `CaptureRecordSchema.parse(record)`
and then writes the file. If the parse throws, or `mkdir` fails, or
`writeFile` fails (disk full, permissions, the dir is a file), the exception
propagates out of `record` before step 2 runs. By then the model has already
been called, the tokens have been spent, and the response is in hand. The
HTTP adapter catches the exception and returns 502, so the caller sees a
failure but the log has no line for it. The review reproduced this: one
provider call, zero log lines.

Before finding 1 is fixed, a content-block array is one trigger: the capture
schema refuses it, the capture throws, the log line is skipped, and the
unvalidated injection has already reached the model unlogged. After finding 1
the shape trigger goes away, but every filesystem failure mode remains.

Second problem, same method: the capture is written with the full `request`
even when the input guardrail blocked it. The guardrail that blocks
`secret-exfiltration` fires on patterns like `password = <12+ chars>` or an
AWS key. Blocking it means the gateway judged the content too sensitive to
send to a model. It then writes that content, verbatim, to
`gateway-captures/<id>.json`. The capture directory is created with the
process umask (typically `0o755`) and the files with `0o644`, so any user on
the host can read them. The redaction that protects the trace span and the
output does not protect the capture of the input.

### The plan

1. Failing tests: (a) `captureContent: true` with a capture dir that is a regular file: a served call still leaves exactly one log line and the call still succeeds; (b) a request blocked by `secret-exfiltration` produces a capture file that does not contain the secret string; (c) `statSync(file).mode & 0o777 === 0o600` and the dir is `0o700`.
2. Reorder `record`: append the log line first, then write the capture inside its own `try`. On capture failure write one stderr line and set a `capture.error` attribute on the span. The rule the code must satisfy: no path from a model call to return skips the append. The log is the record; the capture is a convenience.
3. When the input stage blocked, write `request: null` in the capture. Widen `CaptureRecordSchema.request` to nullable; the `v: 1` record stays readable by existing tooling.
4. `mkdir(dir, { recursive: true, mode: 0o700 })` and `writeFile(path, body, { flag: "wx", mode: 0o600 })`. Capture files hold prompts and model output; only the operator should read them.

As built (branch `sec-4-capture-after-log`):

- `CaptureRecordSchema.request` is now `GenerateRequestSchema.nullable()` from `@grade-stack/core` instead of a restated shape. This also fixes a pre-existing bug found during finding 1: the restated shape lacked `requiresReview` (Phase 4D), so with capture on every L1 or review-flagged request failed the capture write and, before the reorder, the whole call. A test covers it.
- `request: null` applies to every input-stage block (secret, injection, kill switch, turn cap, model allowlist, token cap), not only `secret-exfiltration`. The rule is simpler and none of those requests was sent to a model.
- A failed capture write logs `gateway: capture write failed (request <id>): <message>` to stderr and sets `capture.error` (truncated to 300 characters) on the `gateway.generate` span. The test asserts both the single log line and the span attribute.
- The `mkdir` mode applies only when the directory is created; an existing capture directory keeps the mode the operator gave it.
- Residual: the log line's `contentCaptured` still means "capture was on", because the line is now written before the capture. A line can say `true` when the capture write failed or holds `request: null`, so *reconstructable* can read slightly high. Making it exact would need a second record after the capture, which ADR 0017's one-line-per-call rule does not allow; left as is.

---

## 5. Vulnerable dependencies (Medium)

### The problem

`bun audit` on the current tree reports 171 advisories: 3 critical, 82 high,
73 moderate, 13 low. That is up from 157 at the review. Most come through
`promptfoo`, the eval harness, which pulls a large tree (`ws`, `protobufjs`,
`node-forge`, `fast-uri`, old `express`). The ones that matter at runtime,
in code the gateway and MCP server actually execute, are in
`@modelcontextprotocol/sdk@1.29.0`:

- HTTP server transports did not limit request body size or JSON-RPC batch length (high). A client can send one enormous batch and exhaust server memory.
- One request within the size limit could still exhaust memory during validation (high).
- Experimental tasks were not tied to the session that created them (high). One session could act on another's tasks.
- The OAuth client could send credentials to an authorization server chosen by the MCP server (high). Not exercised by this stack today, but the code is linked in.
- Server bearer authentication accepted tokens issued for another service (moderate). Relevant because 4E added bearer auth; this stack does its own check, but the SDK's helper is in the tree.

The SDK is locked at 1.29.0 in three places: `packages/mcp-server`,
`reference-agent`, and `packages/cli`. The review named the first two and
missed `cli`. Fixes land in 1.31.0; the latest is 1.32.2. The SDK's own
transitive deps (`express`, `body-parser`, `proxy-addr`, `qs`, `hono`,
`fast-uri`) move with it.

There is also no mechanism. Nothing in CI runs an audit, so this list grows
silently. The repo's principle is that a rule without a mechanism binds
nobody; dependency hygiene currently has only a rule.

One complication for the mechanism: `promptfoo` is listed under
`dependencies` in `packages/evals/package.json`, not `devDependencies`. So
`bun audit --prod`, the natural way to gate on runtime deps only, still
includes promptfoo's whole tree and fails on advisories no one can fix.

### The plan

1. Bump the SDK to `^1.32.2` in all three packages, `bun update`, run the gate. Watch `reference-agent/src/mcp.ts` and `packages/mcp-server/src/connect.ts` for API changes (the transport constructor options in particular, which finding 7 needs).
2. `bun update promptfoo`, then `bun audit` again and triage what is left into three buckets: fixable now, dev-only with no fix, runtime with no fix. The third bucket should be empty; if it is not, each entry needs an ADR line.
3. CI: add `bun audit --audit-level=high --prod` to the `build` job in `.github/workflows/ci.yml`. For `--prod` to mean anything, `promptfoo` must move to `devDependencies` in `packages/evals/package.json`. **Decision needed:** `reliability eval` shells out to promptfoo at runtime, so it is arguably a runtime dependency of the eval command. Recommendation: move it to `devDependencies`, record in an ADR that the eval harness is a development tool whose tree is audited but not gated, and have the nightly job print the audit summary so the number stays visible. Default if no answer: do that.
4. Any allowlisted advisory gets a comment in `ci.yml` naming the GHSA id and a line in the same ADR saying why it is accepted.

### As built (branch `sec-5-dependency-audit`)

- **The gate is a script, not `bun audit --prod`.** Bun 1.3.12's `bun audit`
  reads `bun.lock` and silently ignores unknown flags, so `--prod` changed
  nothing (85 high and critical with or without it, and after a
  `--production` install). CI runs `bun run audit:runtime`
  (`scripts/check-dependency-audit.ts`), which walks the lockfile from runtime
  dependency edges only and fails on high or critical advisories there. It
  failed on 15 before the fix and exits 0 after. ADR 0022.
- **promptfoo was already a dev dependency** (since Phase 0); the problem
  statement above misread `packages/evals/package.json`. No move was needed.
  Updated within range to 0.121.20; `reliability eval` and the stub eval gate
  still pass from a workspace install.
- **SDK** `^1.32.2` in all three packages, no API change. `zod` `^4.6.7`.
  Root `overrides` floor the runtime transitives and the dev-only ones with a
  single in-range fix.
- **Counts:** full tree 171 before, 40 after (2 critical, 26 high, 11
  moderate, 1 low), all dev-only through promptfoo. Runtime: 0 at any
  severity. The remaining list, with GHSA ids, is in ADR 0022. No allowlist.
- **Nightly:** the full `bun audit` summary is printed, not gated.

---

## 6. Regex guardrails are easy to evade; model allowlist is weak (Low)

### The problem

**Evasion.** The injection and secret guardrails are regexes over the raw
request text. Regexes match exact characters, and Unicode offers many ways to
write what a human reads as the same text:

- A zero-width space (U+200B) inside a word: `Ignore​ previous instructions`. Invisible when rendered, but `/ignore\s+previous/i` does not match because `​` is neither `\s` nor a letter.
- Full-width Latin letters: `Ｉｇｎｏｒｅ previous instructions`. Renders as the words, but the code points are U+FF29 onward, not ASCII.
- Paraphrase: "Ignore every one of the earlier instructions." No regex set catches all phrasings; ADR 0007 already concedes the recall limit.

The first two are mechanical and cheap to close with normalisation. The third
is a known limit and is not fixed here; what is fixed is that the scorecard
currently credits the regexes as full mitigation of the OWASP injection
threat, which overstates them.

**Allowlist.** `checkModel` (`policy.ts:203-204`) does:

```ts
if (policy.allowedModels.length === 0) return null;
if (policy.allowedModels.some((allowed) => model.includes(allowed))) return null;
```

Two problems. An empty list means "allow everything," so the default policy
(`allowedModels: []`) has no model boundary at all. And the match is
`includes`, a substring test, so an allowlist entry of `claude-haiku` permits
`evil-claude-haiku-clone` or any model id someone constructs around the
substring. 4E's per-agent manifests build their model boundary on this
function, so the agent boundary inherits the weakness.

### The plan

1. Failing tests: zero-width-space and full-width injection variants are blocked; `checkModel` refuses `evil-claude-haiku-clone` against an exact allowlist entry; an empty allowlist is no longer the default.
2. `inputText`: `normalize("NFKC")` (folds full-width and compatibility forms to their base), strip `​-‏`, `⁠-⁤`, `﻿` (zero-width and format characters), collapse runs of whitespace. Normalise only the copy that is scanned; the request forwarded to the model is unchanged, so the gateway never alters what the caller asked.
3. `checkModel`: exact match, or `prefix:` entries for an explicit prefix match. Default allowlist becomes the default model ids from `bedrock.ts` and `ollama.ts` plus the stub's. Check `agent-boundary.test.ts`, since manifests layer on `DEFAULT_POLICY.allowedModels`.
4. In `packages/scorecard/src/owasp.ts` and `governance/owasp/`, mark regex injection denial as partial mitigation. Scorecard tests reflect partial credit. This changes the A letter's inputs, so note it in the governance mapping's change log.

---

## 7. MCP server: unauthenticated by default and open to DNS rebinding (Low)

### The problem

`packages/mcp-server/src/connect.ts:78` has the same `Bun.serve` without
`hostname` as finding 2, so it binds `0.0.0.0`. As with the gateway, 4E added
bearer auth when manifests are present, and nothing when they are not.

The second issue is specific to HTTP servers on localhost. DNS rebinding
works like this: a web page the operator visits in a browser resolves
`attacker.example` to the attacker's IP, loads, then the attacker flips the
DNS record to `127.0.0.1`. The page's JavaScript now makes requests to
`http://attacker.example:<port>/mcp`, which the browser sends to the local
MCP server with `Host: attacker.example`. Same-origin policy does not help
because, from the browser's view, the origin has not changed. The local
server answers, and the page reads the tools and calls them.

The defence is for the server to check the `Host` header against the names
it expects to be called by, and the `Origin` header against the pages it
expects to serve. The MCP SDK transport has this built in
(`enableDnsRebindingProtection`, `allowedHosts`, `allowedOrigins`) and it is
off by default; the transport at line 123 is constructed with only
`sessionIdGenerator: undefined`.

The data this server returns is fake, so the direct damage is nil. The
reason to fix it is that this is the reference implementation others will
copy, and a reference that leaves rebinding protection off teaches the wrong
default.

### The plan (after 5)

Same `hostname` default and non-loopback-requires-agents rule as finding 2.
Pass `enableDnsRebindingProtection: true`,
`allowedHosts: ["127.0.0.1:<port>", "localhost:<port>"]`, and an
`allowedOrigins` list to the transport, checking option names against SDK
1.32. Tests: a request with `Host: evil.example` is refused; the URL is
loopback.

---

## 8. Cleanups (Informational)

### The problems, one each

- **Unpinned GitHub Actions** (`ci.yml:17,18,48,49,69`). `actions/checkout@v4` is a moving tag; whoever controls the tag controls what runs in CI with the repo's token. Pinning to a commit SHA, with the tag in a trailing comment, makes the action immutable until someone updates it deliberately. This is the standard supply-chain hardening for Actions.
- **Local path in a public doc** (`docs/post-mortem.md:212`). The post-mortem quotes an error that includes `/Volumes/Userdata/Users/clarke/...`. That leaks a username and disk layout into a public repo. Replace it with the repo-relative path `governance/owasp/owasp-agentic-top10-2026.json`.
- **Comment contradicts package.json** (`packages/evals/src/run.ts:256`). The comment says promptfoo is pinned, so the update nag is noise. `package.json` says `^0.121.15`, a range. One of them is wrong; a reader trusting the comment will think the eval harness is reproducible when it is not. Fix the comment to match whatever finding 5 decides. **Done on `sec-5-dependency-audit`:** the comment now says the version is a range fixed by `bun.lock` (ADR 0022).
- **No request body limit** on the gateway's `Bun.serve`. Bun's default `maxRequestBodySize` is 128 MB. The gateway accepts small JSON; a 1 MB cap costs nothing and turns a memory-exhaustion attempt into a fast 413. Add the same to the MCP server.

---

## Out of scope (verified fine by the review)

No secrets in the tree or history. Spawns use fixed argument arrays. HTML
reports escape dynamic text. CI uses read-only `pull_request` permissions.
Request ids are pattern-checked before use as file names. The air-gap host
check handles loopback forms.

## Execution

Each branch is delegated to one Opus subagent with this file's section as the
brief, test first, gate before push. Fable reviews the diff and the test's
failing-then-passing evidence before the PR. Update this file's status column
as branches merge. The review moved from `docs/grade-stack-security-fixes.txt`
to `docs/security-review-2026-10-29.md` on the first branch so it is tracked
next to its plan.
