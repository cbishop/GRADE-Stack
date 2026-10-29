# Rollback protocol

> **Template.** A deployer fills in every `<fill in>` field and keeps this file
> with the deployment, next to `docs/logging-and-retention.md`. The kill switch,
> the release manifest and the drill are the stack's mechanisms; who pulls the
> switch, when, and how a release is redeployed are yours. Phase 4C, ADR 0018.

## 1. Deployment

- **System:** <fill in: agent name and purpose>
- **Gateway host and environment:** <fill in>
- **Owner (accountable person):** <fill in>
- **Protocol last reviewed:** <fill in: date and reviewer>

## 2. Trigger: when to pull the switch

Pull it first and investigate second when any of these is true:

- <fill in, e.g. the agent sends output that breaks policy to a customer>
- <fill in, e.g. a guardrail is bypassed, or the decision log shows blocks you cannot explain>
- <fill in, e.g. cost or error rate above an agreed line>
- A reviewer, regulator or the system owner asks for it.

The stack has no automatic trigger yet (OWASP ASI10 residual: no runtime anomaly
detector). If a monitor should pull the switch, name it here: <fill in, or "none">.

## 3. Who can pull it

| Role | Name | Can halt | Can resume |
|---|---|---|---|
| <fill in: on-call engineer> | <fill in> | yes | <fill in> |
| <fill in: system owner> | <fill in> | yes | yes |
| <fill in> | <fill in> | <fill in> | <fill in> |

Whoever can write the halt file can halt the gateway, so file-system access to
the gateway host is the real access list: <fill in: who has it, how it is
granted>.

## 4. How to pull it

On the gateway host (or wherever the halt file lives):

```bash
reliability gateway halt --by <your-name> --reason "<why>"
```

The command writes the halt file (`RELIABILITY_HALT_FILE`, default
`.reliability-halt`), appends a `halt` line to the decision log, and prints what
it did. Every gateway watching that file refuses the next request with policy
`kill-switch` and makes no model call. No restart.

- **Halt file path in this deployment:** <fill in>
- **Decision log path in this deployment:** <fill in>
- **To start a gateway halted:** set `RELIABILITY_HALT=1` in its environment.
  `resume` cannot clear that; restart the gateway without it.

Confirm it took:

```bash
reliability gateway log --since <time you halted>
# Gateway halted by <you> at ...: <why>. No requests served until resume.
# Request ... : refused by the kill switch (...); no model call made.
```

## 5. Expected time-to-halt

- **Threshold:** <fill in, at most 5000 ms; the scorecard caps any stated threshold at 5 seconds>
- **Measured in the last drill:** see section 8.

Time-to-halt is measured from the halt command to the first refused request, so
it includes the CLI starting up.

## 6. In-flight requests

The switch is checked once, at the start of each request. A request that had
already passed the check when the halt file appeared runs to completion and is
logged as served; nothing is cut off mid-answer. Every request that starts after
the file exists is refused.

- **What callers see:** HTTP 503 with `{ ok: false, violation: { policy: "kill-switch" } }`; the agent client raises a `GuardrailError`.
- **What callers should do while halted:** <fill in, e.g. queue the email for a human, show a fallback message>
- **Who tells the business it is halted:** <fill in>

## 7. Restoring the last good release

Every eval result carries a release manifest: git sha, prompt hash, model,
provider, tools and policy hash. The last good release is the manifest of the
last result that passed the gate.

```bash
reliability release show                                  # what is running now
reliability release diff <last-good-result.json> <current-result.json>
# Prompt hash changed; model unchanged; tool `lookup_order` added; ...
```

- **Where passing results are kept:** <fill in, e.g. the CI artifact store, or `packages/evals/baseline.stub.json` for the stub gate>
- **How to redeploy a given git sha:** <fill in: your pipeline and the command>
- **Who approves the redeploy:** <fill in>
- **Gateway version, if deployed separately:** <fill in: the gateway is not in the agent manifest; record its git sha here>

Then resume:

```bash
reliability gateway resume --by <your-name> --reason "<what was restored>"
```

## 8. Drill: tested and dated

Run the drill at least every 90 days; the scorecard's *Rollback verified*
criterion (D) grades an older drill At risk and a missing or failed one
Critical.

```bash
bun scripts/rollback-drill.ts --by <your-name> --reason "<why>"
reliability scorecard --drills governance/drills
```

The drill starts a stub-backed gateway, proves it serves, pulls the switch with
`reliability gateway halt`, measures time-to-halt, sends probe requests and
counts provider calls after the halt, resumes, proves service is back, checks
the decision log, and writes `governance/drills/kill-switch-<date>.json`.

**Reference drill (this repo, 2026-10-29):**

| Field | Result |
|---|---|
| Record | `governance/drills/kill-switch-2026-10-29.json` |
| Run by | clarke, "scheduled rollback drill, Phase 4C" |
| Halt command | `reliability gateway halt --by clarke --reason "scheduled rollback drill, Phase 4C"` (source CLI) |
| Time to halt | 143.2 ms (threshold 5000 ms) |
| Probe requests refused | 20 of 20 |
| Provider calls after halt | 0 |
| Resume restored service | yes |
| Decision log | 1 halt, 1 resume, 21 kill-switch refusals |
| Release running | code `f32dfec`, clean; prompt `0d6138a5729f...`, model `stub-deterministic-v1` |
| Scorecard | Rollback verified: Strong, until 2027-01-27 |

**This deployment's last drill:**

- **Date and record file:** <fill in>
- **Run by:** <fill in>
- **Against:** <fill in: the stub gateway, or a staging gateway with the real halt file path>
- **Time to halt / provider calls after halt:** <fill in>
- **Next drill due:** <fill in: within 90 days>
