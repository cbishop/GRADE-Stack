// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/drill.test
 *
 * Tests the kill-switch rollback drill (Phase 4C): an in-process drill halts a
 * live stub gateway, measures time-to-halt, sees zero provider calls after the
 * halt, resumes, and passes; the degraded canary (halting a file the gateway
 * does not watch) fails with provider calls after the halt; the drill record's
 * Zod schema refuses malformed records loudly; and `readLatestDrill` picks the
 * newest record, returns null for a missing directory, and throws on a bad file.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseManifest } from "@grade-stack/core";
import {
  type DrillRecord,
  DrillRecordError,
  DrillRecordSchema,
  drillFileName,
  parseDrillRecord,
  readLatestDrill,
  runKillSwitchDrill,
  writeDrillRecord,
} from "./drill.ts";

const RELEASE = buildReleaseManifest({
  prompt: "p",
  model: "stub-deterministic-v1",
  provider: "stub",
  tools: [],
  policy: {},
  git: { gitSha: "a".repeat(40), dirty: false },
  builtAt: new Date("2026-10-29T00:00:00Z"),
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "grade-stack-drill-test-"));
}

describe("runKillSwitchDrill", () => {
  test("halts a live gateway, zero provider calls after halt, resumes, passes", async () => {
    const r = await runKillSwitchDrill({ actor: "clarke", release: RELEASE, probes: 5 });
    expect(r.passed).toBe(true);
    expect(r.timeToHaltMs).not.toBeNull();
    expect(r.timeToHaltMs as number).toBeLessThan(r.thresholdMs);
    expect(r.providerCallsAfterHalt).toBe(0);
    expect(r.requestsRefused).toBe(5);
    expect(r.resumeRestored).toBe(true);
    expect(r.decisionLog).toEqual({ halt: 1, resume: 1, killSwitchRefusals: 6 });
    expect(DrillRecordSchema.parse(r)).toEqual(r);
  });

  test("degraded canary: halting the wrong file fails the drill with provider calls after halt", async () => {
    const r = await runKillSwitchDrill({
      actor: "clarke",
      release: RELEASE,
      probes: 3,
      thresholdMs: 200,
      degraded: true,
    });
    expect(r.passed).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.timeToHaltMs).toBeNull();
    expect(r.providerCallsAfterHalt).toBe(3);
    expect(r.requestsRefused).toBe(0);
  });
});

describe("drill record schema and files", () => {
  const valid = (over: Partial<DrillRecord> = {}): DrillRecord => ({
    v: 1,
    kind: "kill-switch-drill",
    date: "2026-10-29",
    startedAt: "2026-10-29T09:00:00.000Z",
    finishedAt: "2026-10-29T09:00:01.000Z",
    actor: "clarke",
    reason: "drill",
    target: "stub-backed gateway over HTTP (counting provider)",
    trigger: "halt-file",
    haltCommand: "reliability gateway halt --by clarke --reason drill",
    thresholdMs: 5000,
    timeToHaltMs: 120,
    haltCommandMs: 110,
    servedWhileHalting: 2,
    probes: 20,
    requestsRefused: 20,
    providerCallsAfterHalt: 0,
    resumeRestored: true,
    decisionLog: { halt: 1, resume: 1, killSwitchRefusals: 21 },
    release: RELEASE,
    degraded: false,
    passed: true,
    ...over,
  });

  test("malformed records fail loudly, naming the field", () => {
    expect(() => parseDrillRecord("{", "d.json")).toThrow(DrillRecordError);
    expect(() =>
      parseDrillRecord(JSON.stringify({ ...valid(), date: "Oct 29" }), "d.json"),
    ).toThrow(/d\.json: date/);
    expect(() =>
      parseDrillRecord(JSON.stringify({ ...valid(), providerCallsAfterHalt: -1 }), "d.json"),
    ).toThrow(/providerCallsAfterHalt/);
    expect(() => parseDrillRecord(JSON.stringify({ ...valid(), extra: 1 }), "d.json")).toThrow(
      DrillRecordError,
    );
    const { release: _r, ...noRelease } = valid();
    expect(() => parseDrillRecord(JSON.stringify(noRelease), "d.json")).toThrow(/release/);
  });

  test("written as kill-switch-<date>.json; the latest by startedAt wins", async () => {
    const dir = tmp();
    expect(drillFileName("2026-10-29")).toBe("kill-switch-2026-10-29.json");
    await writeDrillRecord(
      dir,
      valid({ date: "2026-07-01", startedAt: "2026-07-01T09:00:00.000Z" }),
    );
    const newer = await writeDrillRecord(dir, valid());
    const latest = await readLatestDrill(dir);
    expect(latest?.path).toBe(newer);
    expect(latest?.record.date).toBe("2026-10-29");
  });

  test("a missing directory has no drill; a malformed file in it throws", async () => {
    expect(await readLatestDrill(join(tmp(), "nope"))).toBeNull();
    const dir = tmp();
    writeFileSync(join(dir, "kill-switch-2026-10-01.json"), '{"v":1}');
    await expect(readLatestDrill(dir)).rejects.toThrow(DrillRecordError);
  });
});
