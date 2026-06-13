# ADR 0004 — Fork-PR eval strategy

- **Status:** Accepted
- **Date:** 2026-06-12
- **Phase:** 1B (CI gating + cost-per-success)

## Context

GitHub Actions does not expose repository secrets to workflows triggered by pull
requests **from forks**. The PLAN (task 1B-3) requires choosing an explicit
strategy so that the eval gate can't silently no-op for external contributors,
and — whichever is chosen — **a fork PR must not be mergeable ungated**.

The PLAN offered three options: (a) gate same-repo PRs + pushes to `main`, with a
maintainer-applied label triggering the eval on fork PRs after review; (b) a
reduced local-model suite for forks; (c) maintainer-triggered `workflow_dispatch`.

A wrinkle specific to this repo: the Phase 1B gate runs against the deterministic
**`stub` provider** (ADR 0003), which needs **no secrets at all**. So the
secret-exposure problem doesn't bite the *current* gate. But the strategy must be
in place for **Phase 2A**, when a real-Bedrock job (AWS creds) is added — at which
point fork-PR secret exposure becomes real.

## Decision

Adopt option **(a)**, implemented now so it's correct when secrets arrive:

- The `eval-gate` job runs on **pushes to `main`** (full suite) and **same-repo
  PRs** (smoke suite).
- **Fork PRs** are gated only after a maintainer applies the **`eval-approved`**
  label (the workflow listens on the `labeled` PR event and guards the job with
  `contains(github.event.pull_request.labels.*.name, 'eval-approved')`). This
  keeps an unreviewed fork PR from running CI it could otherwise influence, and
  is the seam where a future secret-bearing job stays safe.
- **`eval-gate` is a required status check via branch protection** (a
  maintainer/repo-admin setting, documented in `CONTRIBUTING.md`). Because the
  check is required and a fork PR doesn't run it until labeled, **a fork PR
  cannot merge ungated.**

The `build` and `secret-scan` jobs always run (no secrets needed), so fork
contributors still get typecheck/lint/test/build + secret-scan feedback without a
label.

## Rationale

- The PLAN's recommended option; least machinery, and the label is a natural
  human review gate for untrusted contributions.
- Forward-compatible: the same `if:` guard that gates the stub job today protects
  the Bedrock job added in 2A — no rework when secrets enter the picture.
- Branch protection (not a prose rule) is the actual "cannot merge ungated"
  mechanism, consistent with the repo's "mechanisms, not prose" principle.

## Consequences

- Branch protection requiring `eval-gate` must be configured on the GitHub repo
  by a maintainer; it is a repo-admin action, not code, and is recorded as a
  setup step in `CONTRIBUTING.md`. (This ADR does not — and cannot — set it from
  the codebase.)
- Reduced local-model suite for forks (option b) and `workflow_dispatch`
  (option c) are not used; revisit only if (a) proves unworkable.
- **Revisit in Phase 2A** alongside ADR 0003 when the real-Bedrock job lands: the
  `eval-approved` label then becomes the trigger that lets a reviewed fork PR run
  the secret-bearing eval.
