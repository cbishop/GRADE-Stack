# ADR 0017: Gateway decision log: JSONL, append-only, hashes by default, identity attributes

- **Status:** Accepted
- **Date:** 2026-10-28
- **Phase:** 4B (traceability: the gateway decision log and request identity)

## Context

The gateway (ADR 0007) blocks, redacts and routes every model call, but before
4B it recorded none of those decisions. Traces (ADR 0008) were opt-in, carried
no request or caller id, and held no content, so a run could be inspected but
not attributed or replayed. The gap analysis
(`docs/gap-analysis-assurance-loop-2026-10-28.md`, row 2) and Phase 4A's
downgrade of EU AI Act Art 12 / Art 26(6) to `partial` both turn on this: a
reviewer asks "show me what the gateway refused last week, for whom, and why",
and there was nothing to show.

The log is also the substrate for 4C (halt and resume lines), 4D (review
decisions) and 4E (boundary refusals), so its format has to hold up as more
writers arrive.

## Decision

**1. One JSONL line per `generate` call, on every path.** Allow, input block,
output block, redaction, router decision and upstream error each write exactly
one line. The write happens inside `GatewayService.generate`, after the
decision and before the response, so there is no path through the gateway that
skips it. If the write fails, the call fails (HTTP 502). A decision that cannot
be recorded is not served.

**2. A strict Zod schema (`DecisionRecordSchema`, `packages/gateway/src/decision-log.ts`).**
Every line answers who (`requestId`, `callerId`, `callerVerified`), what
(`action`, `stage`, `servedBy`, `model`, `escalated`, `confidence`), why
(`policy`, `reason`) and when (`at`, ISO 8601 UTC), plus `inputSha256`,
`outputSha256`, `tokens`, `latencyMs` and `contentCaptured`. The schema is
strict: an unknown key, such as a raw `prompt` field, fails validation and the
line is not written. Records are validated on write and on read; a malformed
line makes `reliability gateway log` and `reliability scorecard --decision-log`
fail with its file and line number. Nothing skips a bad line.

**3. Append-only file, never truncated by the stack.** Path from
`RELIABILITY_DECISION_LOG` (default `./gateway-decisions.jsonl`). Each record is
one `O_APPEND` write of one line, so concurrent requests and concurrent gateway
processes interleave whole lines and lose none (tested with two writer
processes). The stack has no rotate, truncate or delete path. Retention is the
deployer's policy, stated in `docs/logging-and-retention.md`.

**4. Hashes by default; content is opt-in.** The log holds SHA-256 of the
request JSON and of the text returned to the caller (after redaction), never
the text. `RELIABILITY_TRACE_CONTENT=1` turns on content capture: one JSON file
per request id under `RELIABILITY_CAPTURE_DIR` (default `./gateway-captures/`),
holding the request and the returned text, the prompt on the `chat` span
(`gen_ai.input.messages`), and the returned text on the `gateway.generate`
request span (`gen_ai.output.messages`), set after output redaction from the
same string written to the capture file. The
capture hashes to the log line, which is what makes a run reconstructable.
Capture is local, so the sovereign variant's egress guard (ADR 0012) is
unaffected.

**5. Request identity on the envelope and the spans.** `RequestContext`
(`requestId`, optional `callerId`, optional `sessionId`) lives with the wire
contract in `@grade-stack/core`, beside `GatewayGenerateBody`, so the agent-side
client can send it without depending on the credentialed gateway package. The
HTTP adapter reads `x-request-id` and `x-caller-id` (headers win over the body's
`context`), generates a UUID when no request id is given, echoes it on every
response, and refuses (400) any id that is not 1 to 128 characters of
`[A-Za-z0-9._:@-]`, since ids become file names and log fields. The gateway's
root span (`gateway.generate`) and every `chat` span carry
`grade_stack.request_id`, `grade_stack.caller_id` and `enduser.id` (the last two
only when a caller id is supplied), so a log line and its trace join on request
id.

**6. Caller ids are unverified in 4B.** `x-caller-id` is a self-asserted header
(dev only) and every record says `callerVerified: false`. Phase 4E replaces it
with bearer tokens. The scorecard caps *attributable* at Adequate while any
caller id is unverified.

**7. Two computed D criteria.** With `reliability scorecard --decision-log
<file>`: *attributable* is the share of records with both a request id and a
caller id (Strong at 100% and verified); *reconstructable* is the share with
captured content, banded with `standardBand` and dropped one band when the
logging record states no retention period (the `Retention period:` line in
`docs/logging-and-retention.md`, or `--logging-record`). Without the flag both
stay stubbed with `fillsIn: "4B"`. The degraded canary: a gateway started with
`RELIABILITY_DEGRADED=1` drops caller ids before logging, and D falls to
Critical.

## Rationale

- **JSONL** is greppable, appendable without a lock, streams into any log
  pipeline (Loki, CloudWatch, Splunk) unchanged, and each line validates on its
  own. A database would add a service to run for no gain at this scale.
- **Append-only with no delete path** keeps the stack from being the thing that
  loses a record. Deletion is a retention decision, and retention belongs to the
  deployer and their legal basis.
- **Hashes by default** keep personal data out of the one record that must be
  on and kept. Content is the part a deployer has to justify keeping, so it is
  opt-in and in a separate place with its own retention line.
- **Fail closed on a write error** is the mechanism behind "every decision is
  recorded". Logging on a best-effort basis would make that a sentence, not a
  rule.

## Consequences

- EU AI Act Art 12 / Art 26(6) moves back to `supported`, with the residual
  stated: retention is the deployer's policy, caller ids are unverified until
  4E, and only traffic through the gateway is logged. Governance readiness rises
  from 0.58 to 0.67, still At risk. NIST MEASURE 3 and MANAGE 4 name the log as
  a mechanism but stay `partial`; their other residuals (4C, 4D, 4F) remain.
- **No span holds raw model output, even with capture on.** The first 4B cut
  wrote the model's output on the `chat` span before redaction, so a trace
  could carry an SSN the capture file had redacted. Fixed: the core `chat`
  wrapper no longer records output, and the gateway records the redacted text
  on the request span, once, from the string it captures. A `gateway.test.ts`
  test fails if any exported span attribute holds the unredacted value. The
  prompt is still recorded as sent (input is blocked, never redacted), so a
  deployer who exports traces with capture on must still treat the trace
  backend as holding personal data. `docs/logging-and-retention.md` says so.
- **By default *reconstructable* reads Critical,** because the default log holds
  hashes only. That is the honest grade for a deployment that cannot replay a
  request; turning capture on and stating a retention period is what moves it.
- **Router votes are not logged individually.** One line per request records
  the served result's tokens, the agreement and whether it escalated; the N
  local votes appear only as `chat` spans.
- **A disk-full or permission error now takes the gateway down for that
  request.** That is intended. Monitoring the log volume is the operator's job.
- The request id is the join key for 4C to 4F: halt and resume, review
  decisions and boundary refusals will each write a line in this log.
