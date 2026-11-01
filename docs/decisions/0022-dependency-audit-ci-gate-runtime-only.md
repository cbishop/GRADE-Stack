# ADR 0022: Dependency audit as a CI gate; the eval harness tree is audited but not gated

- **Status:** Accepted
- **Date:** 2026-11-01
- **Phase:** Security fixes, finding 5 (`docs/security-fixes-plan-2026-11-01.md`)

## Context

`bun audit` reported 171 advisories (3 critical, 82 high, 73 moderate, 13
low) and nothing in CI ran it, so the list grew silently: 157 at the review
on 2026-10-29, 171 three days later. Fifteen of the high and critical ones
were in code the gateway and MCP server execute: `@modelcontextprotocol/sdk`
1.29.0 (unbounded body and batch size, memory exhaustion in validation, tasks
not tied to their session, OAuth credentials sent to a server-chosen
authorization server), `zod` 4.4.3, and the SDK's `express` stack
(`fast-uri`, `body-parser`, `proxy-addr` critical, `ip-address`). Most of
the rest came through `promptfoo`, the eval harness.

The plan's suggested gate was `bun audit --audit-level=high --prod`. It does
not work. Bun 1.3.12's `bun audit` reads `bun.lock`, not `node_modules`, and
silently ignores flags it does not know: `--prod`, `--production`,
`--omit=dev` and `--bogus-flag` all give the same 85 high-and-critical
results, and so does a lockfile installed with `bun install --production`. A
gate on that command would audit promptfoo's tree and fail forever on
advisories no one here can fix.

The plan also assumed `promptfoo` was under `dependencies` in
`packages/evals/package.json`. It has been a `devDependency` since Phase 0;
the review misread it.

## Decision

**1. The gate.** The CI `build` job runs `bun run audit:runtime`
(`scripts/check-dependency-audit.ts --audit-level=high`) right after install.
The script runs `bun audit --json`, walks `bun.lock` from every workspace's
`dependencies`, `optionalDependencies` and `peerDependencies`, never across a
`devDependencies` edge, follows Bun's nested-key resolution, and fails on
any high or critical advisory whose vulnerable range covers a package
version reachable that way. It fails closed: unreadable audit output or an
unresolvable required runtime dependency is a failure. It prints the
full-tree count on every run. `scripts/check-dependency-audit.test.ts`
proves it on a synthetic lockfile: dev-only vulnerable packages pass, runtime
ones (direct, through another workspace, or optional) fail, a nested patched
copy is judged by its own version.

**2. Why runtime only.** Runtime is what a deployer ships and what an
attacker can reach. The eval harness runs on a developer machine or in CI
against our own suite; its advisories are real but not reachable from a
gateway request or an MCP call. Gating on them would block every PR on
upstream fixes we cannot make, and a gate everyone learns to ignore is worse
than none.

**3. promptfoo stays a dev dependency.** `reliability eval` spawns `bun x
promptfoo` from `packages/evals`, and `bun install` installs dev
dependencies by default, so the eval command works from a workspace install
(the local `Stop` hook gate and the CI eval gate both pass). The eval harness
is a development tool. A production install without dev dependencies would
make `bun x` fetch promptfoo from the registry at run time; running evals
from such an install is not supported.

**4. Fixes and overrides.** The MCP SDK is `^1.32.2` in `mcp-server`,
`reference-agent` and `cli` (no API change was needed), `zod` is `^4.6.7` in
every workspace, and promptfoo moved within its range to 0.121.20. Root
`overrides` force patched versions where a transitive would not move on its
own: runtime (`fast-uri`, `body-parser`, `proxy-addr`, `ip-address`, `hono`,
`@hono/node-server`, `qs`, `zod`) and dev-only with a single in-range fix
(`@xmldom/xmldom`, `compression`, `engine.io`, `follow-redirects`,
`mongoose`, `node-forge`, `socket.io-parser`, and the MCP SDK copy nested
under promptfoo). Each override is a floor inside every requirer's declared
range. A whole-lockfile refresh would have fixed a few more dev-only
advisories but moved about 60 runtime packages (OpenTelemetry, the AWS SDK,
Smithy, express), which is out of scope for a security fix.

**5. Visibility.** The nightly real-model workflow runs the full `bun audit`
with `continue-on-error: true` and writes its summary line to the job summary.

**6. No allowlist.** No advisory is ignored. The runtime set is clean at
every severity, not just high. If a runtime advisory ever has no fix, it gets
an `--ignore`-style entry in the script with its GHSA id and a line here
saying why, never a silent skip.

## Counts

| | Advisories |
|---|---|
| Full tree, before | 171 (3 critical, 82 high, 73 moderate, 13 low) |
| Full tree, after | 40 (2 critical, 26 high, 11 moderate, 1 low) |
| Runtime, high and above, before | 15 |
| Runtime, any severity, after | 0 |

## Dev-only advisories that remain (no fix inside the requirers' ranges)

All reach the tree only through `promptfoo` and its optional providers.

- `@simple-git/argv-parser` 1.1.1, via `simple-git` ^1.1.0: GHSA-v5rq-49vh-5v5c (critical).
- `simple-git` 3.36.0, promptfoo wants ^3.33.0, fix is 4.0.1: GHSA-x6jw-m9v5-85vh (critical), GHSA-858h-whjf-mvg5, GHSA-g4wm-2vf7-vfgr.
- `adm-zip` 0.5.17, via `onnxruntime-node` ^0.5.16: GHSA-xcpc-8h2w-3j85, GHSA-7q85-xj36-vmfc, GHSA-rcw4-f5rp-g42v, GHSA-j5f4-cc29-5x44, GHSA-8238-w5pm-2374, GHSA-vwc7-r8mq-g2x9, GHSA-p634-w6r4-rjp2, GHSA-c6fg-446q-cg94.
- `@azure/msal-node` 5.2.4, fix is 7.1.0: GHSA-xcx6-jx8p-x3h5.
- `basic-ftp` 5.3.1, via `get-uri` ^5.3.1: GHSA-c475-qrg2-pj4r.
- `sharp` 0.34.5, the copy under `@huggingface/transformers` ^0.34.5: GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w.
- `js-yaml` 5.2.2, pinned exactly by promptfoo: GHSA-r3ph-w7gj-g6xm. The nested 4.2.0 copy: GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh.
- `minimatch` 10.2.5 and 9.0.9, fix is 11.0.1: GHSA-g3hv-75wg-m249.
- `glob` 13.0.6 and 10.5.0, fix is 14.0.2: GHSA-3g3m-2fjr-6pw4.
- `ws` 8.20.1, the copies under `engine.io-client` and `socket.io-adapter` (~8.20.1): GHSA-96hv-2xvq-fx4p.
- `@ai-sdk/provider-utils` 4.0.28, pinned exactly by `ai`: GHSA-866g-f22w-33x8 (low).

Fixable only with a lockfile-wide refresh, deferred for the reason in decision 4:

- `brace-expansion` 5.0.6 and 2.1.1 (two majors, one override cannot cover both): GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-3jxr-9vmj-r5cp, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr.
- `protobufjs` 8.6.3 and 7.6.3 (two majors): GHSA-jfj6-75fj-8934, GHSA-j3f2-48v5-ccww.

## Consequences

- A PR that adds or keeps a high or critical advisory in runtime code fails
  the `build` job. The fix is `bun update <pkg>` or a root override.
- The gate needs the npm advisory endpoint. If it is unreachable the job
  fails closed; rerun it.
- Dev-tree advisories do not block anyone. The nightly summary shows the
  count; upgrading promptfoo past its 0.121 range (0.125 is current) is the
  main lever and is its own change.
- Root overrides apply to the whole tree, promptfoo included. Each is a
  semver-compatible floor, but an upstream that later needs a lower version
  would conflict; drop the override when its requirers have moved past it.
