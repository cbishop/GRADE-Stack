#!/usr/bin/env bash
# Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
# SPDX-License-Identifier: Apache-2.0
#
# PreToolUse hook: stop Claude Code from writing obvious secrets into files via
# Write/Edit/MultiEdit. Fast local feedback only — the CI gitleaks scan
# (.github/workflows/ci.yml) is the mechanism of record. Exit 2 = block the tool.
set -euo pipefail

payload="$(cat)"

secret_re='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[0-9A-Za-z]{36,}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}'

if printf '%s' "$payload" | grep -qE "$secret_re"; then
  echo "secret-guard: refusing to write — content matches a secret pattern. Inject secrets via environment variables, never into tracked files." >&2
  exit 2
fi

exit 0
