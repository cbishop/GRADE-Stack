#!/usr/bin/env bash
# Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
# SPDX-License-Identifier: Apache-2.0
#
# Placeholder eval gate — NO-OP in Phase 0.
#
# Phase 1B wires this to the eval harness so a session/commit that regresses agent
# quality below threshold is blocked automatically (mechanism, not prose). Until
# then it intentionally allows everything (exit 0).
set -euo pipefail
exit 0
