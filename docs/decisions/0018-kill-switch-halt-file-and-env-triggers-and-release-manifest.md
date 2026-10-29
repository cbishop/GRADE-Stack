# ADR 0018: Kill switch with halt-file and env triggers; the release manifest

- **Status:** Accepted
- **Date:** 2026-10-29
- **Phase:** 4C (rollback: kill switch, release manifest, and a dated drill)

## Context

Rollback was one of two assurance pillars with no code. The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`, row 3) found no kill switch
(the OWASP ASI10 residual said so) and no record of which version an eval
measured: results carried provider, model and a timestamp, so there was nothing
to roll back to. The Assessment promises a "kill-switch record, tested and
dated", and a bank's reviewer asks two things: can you stop it, and which
version would you go back to?

The gateway is already the only path to a model (ADR 0007), so one check there
halts every agent behind it. The decision log (ADR 0017) is already the place
operator actions should be recorded.

## Decision

**1. The kill switch is the first thing `GatewayService.generate` does.**
Before any provider is resolved, the gateway reads its halt state. While halted
it returns `{ ok: false, violation: { policy: "kill-switch", stage: "input" } }`
and makes no model call, on the plain forward path and the router path alike.
The refusal goes through the same recording path as every other decision, so it
is one decision-log line with policy `kill-switch`. Over HTTP it is a 503 with
the violation body; the agent-side client raises a `GuardrailError`.

**2. Two triggers, both read on every request.**

- `RELIABILITY_HALT=1` (or `true`) in the gateway's environment. Process-level:
  for an orchestrator that restarts the gateway halted, or a deployment that
  must come up halted. It cannot be cleared from outside the process.
- A halt file, `RELIABILITY_HALT_FILE` (default `.reliability-halt`), holding
  `{ by, reason, at }` (strict Zod `HaltRecordSchema`). Written atomically
  (temp file plus rename) by `reliability gateway halt --by <name> --reason
  <text>` and removed by `reliability gateway resume --by <name>`. A running
  gateway halts on the next request; no restart, no signal, no port.

A halt file that is not a valid halt record **fails closed**: the gateway stays
halted, and the refusal reason says the file is malformed. A second `halt` while
halted keeps the first record and writes no line, so the log names whoever
actually stopped it. `resume` writes its log line before removing the file: if
the line cannot be written, the gateway stays halted.

**3. Halt and resume are `control` lines in the decision log.** A second record
kind, `ControlRecordSchema` (strict): `kind: "control"`, `action` (`halt` or
`resume`), `actor`, `reason`, `at`, `haltFile`, and a generated `requestId` for
the operator action. A 4B request line has no `kind`, so every existing log
still reads. The parser picks the schema by `kind`, so a bad control line fails
with the field that is wrong. `reliability gateway log` explains them: "Gateway
halted by clarke at 2026-10-29 09:14:03 UTC: drill. No requests served until
resume." The scorecard's request criteria (attributable, reconstructable) grade
request lines only.

**4. The release manifest** (`packages/core/src/release.ts`, strict
`ReleaseManifestSchema`):

| Field | What it names |
|---|---|
| `gitSha`, `dirty` | The commit, and whether tracked files differed from it. `RELIABILITY_GIT_SHA` / `RELIABILITY_GIT_DIRTY` override for builds with no `.git`; otherwise `unknown`. |
| `promptHash` | SHA-256 of the system prompt with its schema block, as the planner sends it (MCP grounding, which varies per email, is excluded). |
| `model`, `provider` | What answered. |
| `tools[]` | Each MCP tool by name, with a SHA-256 of its argument JSON Schema, taken from the schemas the server registers (`SUPPORT_TOOL_INPUT_SCHEMAS`). |
| `policyHash` | SHA-256 of the agent's runtime policy: turn bound, generation parameters, the validator's output contract. |
| `builtAt` | When the manifest was built. Ignored by the diff. |

Hashes are over canonical JSON (keys sorted), so key order never changes a
hash. The eval runner stamps the manifest into `EvalRunResult.release`; the
reference agent puts it on the `agent.run` root span as
`grade_stack.release.*`. Both call `referenceAgentRelease`, so the same code
names the same version in both places. `reliability release show` prints it;
`reliability release diff <a.json> <b.json>` explains two results in one
sentence ("Prompt hash changed; model unchanged; tool `lookup_order` added;
policy hash unchanged; code at f32dfec."). A result without a manifest (written
before 4C) is refused, not guessed at. On a regression the eval gate adds the
same sentence to its verdict. The committed stub baseline gained the manifest
from a clean run; its scores are unchanged.

**5. A dated drill.** `scripts/rollback-drill.ts` starts a stub-backed gateway
over HTTP with a counting provider, proves it serves, pulls the switch with the
operator CLI, measures the time from the command to the first refused request,
sends probes and counts provider calls after the halt, resumes, proves service
is back, and checks the decision log. The result is a strict `DrillRecord`
written to `governance/drills/kill-switch-<date>.json`, with the release that
was running. The first one is committed: 143.2 ms to halt, zero provider calls
after the halt.

**6. Scorecard D, *rollback verified*.** With `reliability scorecard --drills
<dir>`, computed from the newest record: Strong when dated within 90 days, time
to halt under the drill's stated threshold (capped at 5000 ms), zero provider
calls after the halt, every probe refused and service restored; At risk when
older than 90 days; Critical when missing or failed. The scorecard stays pure:
the CLI passes "now", or `--as-of`, as the date the age is measured against.
Without `--drills` the criterion stays stubbed (fillsIn 4C).

## Rationale

- **A file and an env var, not an endpoint.** An HTTP halt endpoint would need
  its own authentication (4E) and would fail exactly when the gateway is
  overloaded. A file works through any orchestrator, config map or shell, needs
  no new port, and is readable by the gateway with no lock. The env var covers
  "start halted". Both are checked per request, which costs one `readFile` that
  usually fails fast with ENOENT.
- **Fail closed on a bad halt file.** Whoever wrote it meant to stop something.
- **Hashes, not copies, in the manifest.** The manifest has to travel with every
  result and span; the prompt and schemas are in git at `gitSha`. A hash says
  whether they changed; git says how.
- **The drill uses the operator's real command.** Time-to-halt includes the CLI
  starting up, because that is what an operator waits for.

## Degraded canaries

- `bun scripts/rollback-drill.ts --degraded` halts a file the gateway is not
  watching (the real misconfiguration where operator and gateway disagree on
  `RELIABILITY_HALT_FILE`). The gateway keeps serving, the record shows provider
  calls after the halt, the script exits 1, and the scorecard grades Critical.
- `reliability scorecard --drills <dir> --as-of <later date>` shows a stale drill
  dropping D to At risk; an empty directory drops it to Critical.

## Consequences

- OWASP ASI10 names the kill switch as its first mechanism; the residual narrows
  to "no runtime anomaly detector": the switch is manual. NIST MANAGE 2 (2.4
  deactivation) and MANAGE 4 (recovery) name it; both stay partial (4D, and the
  deployer's strategy).
- **In-flight requests finish.** A request that passed the check before the halt
  file appeared completes and is logged as served. The drill records how many
  (`servedWhileHalting`); with a sequential client that is the requests served
  while the halt command was starting.
- **The gateway policy is not in the manifest.** The manifest describes the agent
  release; the gateway is a separate deployable with its own policy
  (`GatewayPolicy`). Hashing it into agent results would couple the two. A
  deployer who versions them together should record the gateway's git sha in
  the rollback protocol.
- **`dirty: true` is honest, not an error.** A run from a working tree with
  uncommitted changes says so; its sha alone does not name the code.
- **Restoring the last good version is a deploy, not a stack verb.** The
  manifest names it (`reliability release diff` against the last passing
  result); redeploying it is the deployer's pipeline, written into
  `docs/rollback-protocol.md`.
- Automatic triggers (error rate, cost spike) stay deferred (PLAN v3, "Deferred").
