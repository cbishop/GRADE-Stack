#!/usr/bin/env bash
# Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
# SPDX-License-Identifier: Apache-2.0
#
# Local eval gate, wired as the Claude Code `Stop` hook (Phase 4F).
#
# Runs the hermetic stub eval gate (the same gate CI runs on pull requests:
# six cases, deterministic stub provider, no network, no spend, a few seconds)
# before a session may stop. A regression below the committed stub baseline
# blocks the stop: exit 2 is the Stop hook's "block" code, and stderr (the
# gate's reason) is fed back so the regression is fixed before the turn ends.
# RELIABILITY_DEGRADED=1 is the canary that makes it fail on purpose
# (`packages/cli/src/stop-hook.test.ts`).
#
# This is fast local feedback, not the mechanism of record: the CI `eval-gate`
# job is (ADR 0003). If bun is missing the hook cannot run the gate and says so
# without blocking; CI still gates the change.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 0

# The hook's stdin carries the Stop event JSON; the gate does not need it.
cat >/dev/null 2>&1 || true

if ! command -v bun >/dev/null 2>&1; then
  echo "eval gate skipped: bun is not on PATH (CI still runs the gate)" >&2
  exit 0
fi

output="$(bun run reliability eval gate --provider stub --first-n 6 --max-cost 0.50 2>&1)"
status=$?
if [ "$status" -ne 0 ]; then
  {
    echo "eval gate failed (stub provider, first 6 cases, \$0.50 cap): fix the regression before stopping."
    echo "$output" | grep -E "REGRESSION|COST CAP|release change|FAIL|Could not|error" || echo "$output" | tail -20
  } >&2
  exit 2
fi
exit 0
