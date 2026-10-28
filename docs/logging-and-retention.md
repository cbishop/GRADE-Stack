# Logging and retention record

> **Template.** A deployer fills in every `<fill in>` field and keeps this file
> with the deployment. `reliability scorecard --decision-log <file>` reads the
> **Retention period** line: while it is a placeholder, the *Reconstructable*
> criterion (D) is graded one band lower. Phase 4B, ADR 0017.

## 1. Deployment

- **System:** <fill in: agent name and purpose>
- **Owner (accountable person):** <fill in>
- **Gateway host and environment:** <fill in>
- **Record last reviewed:** <fill in: date and reviewer>

## 2. What is logged

The gateway writes **one line per request** to the decision log, on every path:
allowed, blocked on input, blocked on output, redacted, routed or escalated, and
upstream error. Each line is validated against the `DecisionRecord` schema
(`packages/gateway/src/decision-log.ts`) before it is written.

| Field | Answers | Notes |
|---|---|---|
| `requestId` | which request | From `x-request-id`, else generated. Same value as the `grade_stack.request_id` span attribute. |
| `callerId`, `callerVerified` | who asked | From `x-caller-id`; `null` when absent. Self-asserted until Phase 4E, so `callerVerified` is `false`. |
| `at` | when | ISO 8601 UTC, request start. |
| `action`, `stage` | what the gateway did | `allow`, `redact`, `block` or `error`; `input` or `output` for blocks and redactions. |
| `policy`, `reason` | why | The policy that fired (`prompt-injection`, `secret-exfiltration`, `pii-redaction`, `confidence-router`, ...) and a reason that never echoes the matched text. |
| `servedBy`, `model`, `escalated`, `confidence` | which model answered | `servedBy` is `null` when no model was called. |
| `inputSha256`, `outputSha256` | what was said, as hashes | SHA-256 of the request JSON and of the text returned to the caller (after redaction). |
| `tokens`, `latencyMs` | cost and speed | Tokens of the served result. |
| `contentCaptured` | can it be replayed | `true` when the content was mirrored to the capture directory. |

**Not logged by default:** prompt text, system prompt, model output. The schema
is strict, so a record with a text field fails validation and is not written.

**Opt-in content capture** (`RELIABILITY_TRACE_CONTENT=1`):

- One JSON file per request id in the capture directory, holding the request
  and the text returned to the caller (PII already redacted).
- Prompt and **raw** model output on the `chat` span, as `gen_ai.input.messages`
  and `gen_ai.output.messages`. The span holds the model output *before* output
  redaction. If trace export is on, treat the trace backend as holding personal
  data.

## 3. Where it is kept

| Record | Location | Set by |
|---|---|---|
| Decision log | <fill in> (default `./gateway-decisions.jsonl`) | `RELIABILITY_DECISION_LOG` |
| Content capture | <fill in, or "off"> (default `./gateway-captures/`) | `RELIABILITY_TRACE_CONTENT=1`, `RELIABILITY_CAPTURE_DIR` |
| Traces | <fill in: backend, or "not exported"> | `RELIABILITY_OTEL=1`, `OTEL_EXPORTER_OTLP_ENDPOINT` |

The stack opens the decision log append-only and never truncates, rotates or
deletes it. If a write fails, the request fails (HTTP 502) rather than go
unrecorded.

## 4. How long it is kept

- **Retention period:** <fill in, e.g. 13 months>
- **Legal basis or policy:** <fill in. For an EU AI Act Annex III high-risk system, Art 26(6) asks deployers to keep logs for at least six months unless other law says otherwise.>
- **Who deletes or archives, and how:** <fill in: the stack never deletes; name the job or person>
- **Capture directory retention, if on:** <fill in. It holds personal data; usually shorter than the log.>

## 5. Who can read it

- **Read access to the decision log:** <fill in: roles>
- **Read access to the capture directory and trace backend:** <fill in: roles; narrower than the log>
- **How access is granted and reviewed:** <fill in>

## 6. How to read it

```bash
reliability gateway log                          # one sentence per decision
reliability gateway log --since 2026-10-28T00:00:00Z --caller triage
reliability gateway log --request <id> --json    # the full record
reliability scorecard --decision-log ./gateway-decisions.jsonl   # D: attributable, reconstructable
```

A malformed line makes both commands fail with its file and line number. They
never skip a line.

---

## Reconstructed sample run

A real run, recorded 2026-10-28 against local Ollama (`llama3.2`) with content
capture on: one request from caller `triage` whose reply contained a number in
SSN format. Produced in-process with `GatewayService` inside
`withInMemoryTracing`, the same path `reliability gateway serve` runs.

**1. The decision-log line** (hashes only, no text):

```json
{"v":1,"at":"2026-10-28T20:19:55.925Z","requestId":"sample-7f3a","callerId":"triage","callerVerified":false,"target":"ollama","action":"redact","stage":"output","policy":"pii-redaction","reason":"redacted SSN from the model output before returning it","redactions":["SSN"],"servedBy":"ollama","model":"llama3.2","escalated":false,"confidence":null,"inputSha256":"dacceeb94ab6f6d3e1fd435a416965f689bfafde8954847dd35255362a5425d3","outputSha256":"9639172e4757c005a7a87126eaa9669d38c50fbe9c4c446264ce42495365af99","tokens":{"input":52,"output":30},"latencyMs":219.1,"contentCaptured":true}
```

`reliability gateway log` reads it as:

> Request sample-7f3a from caller triage (unverified) at 2026-10-28 20:19:55 UTC: answered by ollama (llama3.2); SSN redacted by policy pii-redaction before return.

**2. The trace** (one trace id, `8f7258703c8230ccf24889660d29b86d`; content
attributes trimmed):

| Span | Attributes |
|---|---|
| `gateway.generate` (root) | `grade_stack.request_id=sample-7f3a`, `grade_stack.caller_id=triage`, `enduser.id=triage` |
| `chat llama3.2` | the same three, plus `gen_ai.system=ollama`, `gen_ai.usage.input_tokens=52`, `gen_ai.usage.output_tokens=30`, `gen_ai.input.messages`, `gen_ai.output.messages` |

The log line and the trace join on `sample-7f3a`.

**3. The captured content** (`gateway-captures/sample-7f3a.json`):

```json
{
  "v": 1,
  "requestId": "sample-7f3a",
  "callerId": "triage",
  "at": "2026-10-28T20:19:55.925Z",
  "target": "ollama",
  "request": {
    "system": "You are a support assistant.",
    "messages": [
      {
        "role": "user",
        "content": "Draft a one-sentence reply telling the customer their claim number is 123-45-6789."
      }
    ],
    "temperature": 0
  },
  "output": "Your claim number is [REDACTED-SSN], and you can use this reference to track the status of your claim with our team."
}
```

**4. The check.** SHA-256 of `JSON.stringify(request)` equals `inputSha256`, and
SHA-256 of `output` equals `outputSha256` (both verified `true` for this run).
So the capture is the content the log line describes; editing the capture
without also editing the log breaks the match. The raw model output, with the
unredacted number, appears only on the `chat` span's `gen_ai.output.messages`.
