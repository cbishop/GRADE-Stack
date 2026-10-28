# Cycle 14: End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**What your gateway refused today, and why, in one file.**

Last cycle I downgraded my own logging claim. The EU AI Act mapping said
"supported" for record-keeping, and the truth was that the gateway blocked,
redacted and routed every model call without writing any of it down. This cycle
it writes it down.

Every request through the gateway now leaves exactly one line in an append-only
file. Three of them, explained by the stack:

> Request demo-inject from caller triage (unverified) at 2026-10-28 20:23:28 UTC:
> input blocked by policy prompt-injection (request contains an
> instruction-override / jailbreak attempt); no model call made.
>
> Request demo-pii from caller triage (unverified) at 2026-10-28 20:23:28 UTC:
> answered by ollama (llama3.2); SSN redacted by policy pii-redaction before return.
>
> Request demo-escalate from caller triage (unverified) at 2026-10-28 20:23:31 UTC:
> allowed and answered by ollama (llama3.2) after escalation; confidence router:
> local agreement 0% was below the 50% threshold; escalated to ollama.

That is `reliability gateway log`. Add `--json` and you get the full record.

What changed:

**1. One line per request, on every path.** Allowed, blocked, redacted,
escalated, or failed upstream. Each line names the request, the caller, the
action, the policy that fired, the model that answered, tokens and latency. If
the line cannot be written, the request fails. A decision the stack cannot
record is a decision it does not serve.

**2. Hashes, not text.** The log holds a fingerprint of what went in and what
came out, never the words. Turning on content capture keeps a separate copy per
request that hashes back to its log line, so a run can be replayed. It is off by
default because it holds personal data, and how long to keep it is your call.

**3. The log and the trace share an id.** Find the line, find the trace.

**4. The scorecard grades it.** Two new criteria under D, Deployed: attributable
(does every line name who asked?) and reconstructable (can you replay it, and
have you said how long you keep it?). Both read Adequate on the sample. Caller
ids are self-asserted headers until I add real authentication, and the template
still has no retention period filled in. A log with the caller ids stripped
drops D to Critical, and a test proves it.

The EU AI Act record-keeping duty moved back to "supported", with the residual
written down: retention is the deployer's policy, not the stack's.

A bank's reviewer asks "show me what it refused last week." That is now one
command. Next is the kill switch (4C), which will write its halt and resume to
this same file. The decision is ADR 0017; the sample log and scorecard are in
`content/cycle-14/`.
