#!/usr/bin/env bash
# Copyright 2026 Clarke Bishop Consulting
# SPDX-License-Identifier: Apache-2.0
#
# One command to grade the judge (Phase 4F calibration):
#   bun run label-judge
#
# 1. If the labels file already has seeded, unlabeled slots, resume labeling.
#    Otherwise run the full suite on Bedrock locally (about three cents) and
#    seed the judge's verdicts into the labels file.
# 2. Walk you through labeling, one case per screen (blind to the judge).
# 3. Print agreement and kappa, and write them into docs/eval-record.md.
#
# Needs local AWS credentials that can invoke Bedrock. Results land in
# eval-results/ (gitignored). Set LABELER to override the name on the labels.

set -euo pipefail
cd "$(dirname "$0")/.."

LABELS=packages/evals/calibration/labels.json
OUT_DIR=eval-results
MAX_COST="${MAX_COST:-0.50}"
LABELER="${LABELER:-$(git config user.name || echo "")}"

count() { # $1 = jq-style filter in bun
  bun -e "const d=JSON.parse(await Bun.file('$LABELS').text()); console.log(d.labels.filter($1).length)"
}

seeded_unlabeled=$(count 'l => l.judge !== null && l.human === null')
unseeded=$(count 'l => l.judge === null')

if [ "$seeded_unlabeled" -gt 0 ]; then
  echo "Resuming: $seeded_unlabeled seeded slot(s) still unlabeled. Skipping the model run."
elif [ "$unseeded" -eq 0 ]; then
  echo "All 20 slots are seeded and labeled. Re-run with LABEL_ALL=1 to re-review, or hand-edit $LABELS."
  exit 0
else
  echo "Running the full suite on Bedrock (cost cap \$$MAX_COST) to seed $unseeded slot(s)..."
  mkdir -p "$OUT_DIR"
  results="$OUT_DIR/bedrock-$(date -u +%Y-%m-%dT%H%M%SZ).json"
  set +e
  bun run reliability eval run --provider bedrock --max-cost "$MAX_COST" --out "$results"
  code=$?
  set -e
  if [ ! -f "$results" ]; then echo "No results file was written; check AWS credentials and Bedrock access." >&2; exit 1; fi
  if [ "$code" -ge 2 ]; then echo "Run aborted (cost cap or error, exit $code)." >&2; exit 1; fi
  echo
  echo "Seeding judge verdicts from $results"
  bun run reliability eval calibrate --seed "$results"
fi

echo
echo "Labeling. Answer p (pass), f (fail), s (skip) or q (quit); progress saves after every answer."
echo
if [ "${LABEL_ALL:-}" = "1" ]; then
  bun run reliability eval label --by "$LABELER" --all
else
  bun run reliability eval label --by "$LABELER"
fi

echo
echo "Agreement:"
set +e
bun run reliability eval calibrate
cal=$?
set -e

latest=$(ls -t "$OUT_DIR"/bedrock-*.json 2>/dev/null | head -1 || true)
if [ -n "$latest" ]; then
  bun run reliability eval record --results "$latest" >/dev/null
  echo "Wrote docs/eval-record.md from $latest"
fi

echo
case $cal in
  0) echo "Judge is at or above the bar. Commit $LABELS and docs/eval-record.md together." ;;
  1) echo "Judge is below the bar. Each disagreement above is a finding; see packages/evals/calibration/README.md." ;;
  *) echo "Not enough labels yet (need 10). Run bun run label-judge again to continue." ;;
esac
