#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/rollback-drill
 *
 * The kill-switch rollback drill (Phase 4C, ADR 0018). Starts a stub-backed
 * gateway, proves it serves, pulls the kill switch with the operator's real
 * command (`reliability gateway halt`), measures time-to-halt, confirms zero
 * provider calls after the halt, resumes, confirms service is back, and writes
 * the dated record to `governance/drills/kill-switch-<date>.json`. Exits 1 when
 * the drill fails, after writing the record (a failed drill is evidence too).
 *
 *   bun scripts/rollback-drill.ts [--by <name>] [--reason <text>] [--out <dir>]
 *     [--threshold-ms <n>] [--probes <n>] [--cli <built index.js>] [--in-process]
 *     [--degraded]
 *
 * `--cli` runs a built binary (`bun <path>`) for halt and resume; the default is
 * the source CLI. `--degraded` is the canary: it halts a file the gateway is not
 * watching, so the record shows a failed drill and the scorecard drops D.
 */

import { join } from "node:path";
import { parseArgs } from "node:util";
import { createProvider } from "../packages/core/src/index.ts";
import {
  DEFAULT_DRILL_PROBES,
  DEFAULT_TIME_TO_HALT_THRESHOLD_MS,
  runKillSwitchDrill,
  writeDrillRecord,
} from "../packages/gateway/src/index.ts";
import { referenceAgentRelease } from "../reference-agent/src/index.ts";

const repoRoot = join(import.meta.dir, "..");

const { values } = parseArgs({
  options: {
    by: { type: "string", default: "rollback-drill" },
    reason: { type: "string", default: "scheduled rollback drill" },
    out: { type: "string", default: join(repoRoot, "governance", "drills") },
    "threshold-ms": { type: "string", default: String(DEFAULT_TIME_TO_HALT_THRESHOLD_MS) },
    probes: { type: "string", default: String(DEFAULT_DRILL_PROBES) },
    cli: { type: "string" },
    "in-process": { type: "boolean", default: false },
    degraded: { type: "boolean", default: false },
  },
});

const cli = values["in-process"]
  ? undefined
  : ["bun", values.cli ?? join(repoRoot, "packages", "cli", "src", "index.ts")];

const record = await runKillSwitchDrill({
  actor: values.by,
  reason: values.reason,
  release: referenceAgentRelease(createProvider("stub")),
  ...(cli ? { cli } : {}),
  thresholdMs: Number.parseInt(values["threshold-ms"], 10),
  probes: Number.parseInt(values.probes, 10),
  degraded: values.degraded,
});
const path = await writeDrillRecord(values.out, record);

const ttH = record.timeToHaltMs === null ? "never halted" : `${record.timeToHaltMs} ms`;
console.log(
  `Kill-switch drill ${record.date} by ${record.actor}: ${record.passed ? "PASSED" : "FAILED"}`,
);
console.log(`  halt command:        ${record.haltCommand}`);
console.log(`  time to halt:        ${ttH} (threshold ${record.thresholdMs} ms)`);
console.log(`  refused probes:      ${record.requestsRefused} of ${record.probes}`);
console.log(`  provider calls after halt: ${record.providerCallsAfterHalt}`);
console.log(`  resume restored:     ${record.resumeRestored ? "yes" : "no"}`);
console.log(
  `  decision log:        ${record.decisionLog.halt} halt, ${record.decisionLog.resume} resume, ${record.decisionLog.killSwitchRefusals} kill-switch refusals`,
);
console.log(
  `  release:             code ${record.release.gitSha.slice(0, 7)}${record.release.dirty ? " (dirty)" : ""}, prompt ${record.release.promptHash.slice(0, 12)}`,
);
console.log(`record written to ${path}`);
if (!record.passed) process.exitCode = 1;
