// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/drill
 *
 * The kill-switch rollback drill (Phase 4C, ADR 0018) and its dated record.
 * `runKillSwitchDrill` starts a stub-backed gateway over HTTP with a counting
 * provider, proves it serves, pulls the kill switch (through the CLI when a
 * command is given, so the drill exercises the operator's real verb), measures
 * the time from the halt command to the first refused request, sends probe
 * requests and counts provider calls after the halt (must be zero), resumes,
 * proves service is back, and checks the decision log holds the halt, the
 * resume and the refusals. The result is a `DrillRecord`, strict Zod schema,
 * written to `governance/drills/kill-switch-<date>.json` by
 * `scripts/rollback-drill.ts`. The scorecard's D criterion *rollback verified*
 * is computed from the latest one.
 *
 * Degraded canary: `degraded: true` issues the halt against a halt file the
 * gateway is not watching (the real misconfiguration where operator and gateway
 * disagree on `RELIABILITY_HALT_FILE`). The gateway keeps serving, the record
 * says so, and the scorecard drops D.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  type GenerateRequest,
  IDENTITY_ID_PATTERN,
  type ModelProvider,
  type ReleaseManifest,
  ReleaseManifestSchema,
  StubProvider,
} from "@grade-stack/core";
import { z } from "zod";
import { serveGateway } from "./connect.ts";
import { DecisionLog, isControlRecord, readDecisionLog } from "./decision-log.ts";
import { haltGateway, resumeGateway } from "./kill-switch.ts";

/** Default time-to-halt threshold: the gateway must refuse within 5 seconds of the command. */
export const DEFAULT_TIME_TO_HALT_THRESHOLD_MS = 5000;
/** Default number of probe requests sent after the halt takes effect. */
export const DEFAULT_DRILL_PROBES = 20;

const Count = z.number().int().min(0);

/** One dated kill-switch drill. Strict: unknown keys are refused. */
export const DrillRecordSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("kill-switch-drill"),
  /** UTC date of the drill, the `<date>` in the file name. */
  date: z.iso.date(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  actor: z.string().regex(IDENTITY_ID_PATTERN),
  reason: z.string().min(1).max(500),
  /** What was halted, e.g. "stub-backed gateway over HTTP". */
  target: z.string().min(1),
  trigger: z.literal("halt-file"),
  /** The operator command the drill ran to pull the switch. */
  haltCommand: z.string().min(1),
  thresholdMs: z.number().int().positive(),
  /** Halt command issued to first refused request; null when the gateway never halted. */
  timeToHaltMs: z.number().min(0).nullable(),
  /** How long the halt command itself took to return. */
  haltCommandMs: z.number().min(0),
  /** Requests served between the halt command and the halt taking effect (in flight). */
  servedWhileHalting: Count,
  probes: Count,
  requestsRefused: Count,
  /** Provider calls after the halt took effect. Must be zero. */
  providerCallsAfterHalt: Count,
  resumeRestored: z.boolean(),
  decisionLog: z.strictObject({ halt: Count, resume: Count, killSwitchRefusals: Count }),
  /** The release that was running, i.e. the version a rollback would restore to or from. */
  release: ReleaseManifestSchema,
  degraded: z.boolean(),
  passed: z.boolean(),
});

/** A validated drill record. */
export type DrillRecord = z.infer<typeof DrillRecordSchema>;

/** Thrown when a drill record is not valid JSON or fails the schema. */
export class DrillRecordError extends Error {
  override name = "DrillRecordError";
}

/** Parse a drill record; throws {@link DrillRecordError} naming the source and field. */
export function parseDrillRecord(text: string, source: string): DrillRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DrillRecordError(`${source}: not valid JSON`);
  }
  const parsed = DrillRecordSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DrillRecordError(
      `${source}: ${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** `kill-switch-<date>.json`. */
export function drillFileName(date: string): string {
  return `kill-switch-${date}.json`;
}

/** Write a validated record into `dir`; returns its path. */
export async function writeDrillRecord(dir: string, record: DrillRecord): Promise<string> {
  const valid = DrillRecordSchema.parse(record);
  await mkdir(dir, { recursive: true });
  const path = join(dir, drillFileName(valid.date));
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  return path;
}

/**
 * The latest drill in `dir` (by `startedAt`), with its path; null when the
 * directory has none or does not exist. Every `kill-switch-*.json` is
 * validated: one malformed record fails the read rather than being skipped.
 */
export async function readLatestDrill(
  dir: string,
): Promise<{ path: string; record: DrillRecord } | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let latest: { path: string; record: DrillRecord } | null = null;
  for (const name of names.filter((n) => /^kill-switch-.*\.json$/.test(n)).sort()) {
    const path = join(dir, name);
    const record = parseDrillRecord(await readFile(path, "utf8"), path);
    if (!latest || record.startedAt > latest.record.startedAt) latest = { path, record };
  }
  return latest;
}

export interface DrillOptions {
  /** Who ran the drill (recorded as the actor on the halt and resume lines). */
  actor: string;
  /** Why; recorded on the halt line. Defaults to "scheduled rollback drill". */
  reason?: string;
  /** The release that is running; stamped into the record. */
  release: ReleaseManifest;
  /**
   * Command prefix for the operator CLI, e.g. `["bun", "dist/index.js"]`. When
   * given, the drill halts and resumes by running `<cli> gateway halt|resume`,
   * so the time-to-halt includes the operator's real command. Absent, it calls
   * {@link haltGateway} / {@link resumeGateway} in-process.
   */
  cli?: string[];
  thresholdMs?: number;
  probes?: number;
  /** Canary: halt a file the gateway is not watching. The drill must fail. */
  degraded?: boolean;
  /** Working directory for the halt file and decision log; a fresh temp dir by default. */
  workDir?: string;
}

const PROBE_REQUEST: GenerateRequest = {
  system: "You are a customer-support triage assistant.",
  messages: [{ role: "user", content: "Rollback drill probe: I was charged twice, please check." }],
};

/** Run a command to completion; reject with its stderr on a non-zero exit. */
function runCommand(argv: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (!cmd) return reject(new Error("empty CLI command"));
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${argv.join(" ")} exited ${code}: ${err.trim()}`)),
    );
  });
}

/**
 * Run the drill against a fresh stub-backed gateway and return its record.
 * Never throws for a failed drill: a gateway that does not halt is a result,
 * recorded with `passed: false`.
 */
export async function runKillSwitchDrill(opts: DrillOptions): Promise<DrillRecord> {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_TIME_TO_HALT_THRESHOLD_MS;
  const probes = opts.probes ?? DEFAULT_DRILL_PROBES;
  const reason = opts.reason ?? "scheduled rollback drill";
  const degraded = opts.degraded ?? false;
  const dir = opts.workDir ?? mkdtempSync(join(tmpdir(), "grade-stack-drill-"));
  const haltFile = join(dir, ".reliability-halt");
  // The degraded canary halts a path the gateway does not watch.
  const operatorHaltFile = degraded ? join(dir, ".reliability-halt-misconfigured") : haltFile;
  const logPath = join(dir, "drill-decisions.jsonl");
  const log = new DecisionLog(logPath);

  // A counting provider: every model call the gateway makes, with its time.
  const stub = new StubProvider();
  const calls: number[] = [];
  const counting: ModelProvider = {
    name: stub.name,
    model: stub.model,
    generate(req) {
      calls.push(performance.now());
      return stub.generate(req);
    },
  };

  const startedAt = new Date();
  const handle = serveGateway({ decisionLog: log, haltFile, resolveProvider: () => counting });
  let seq = 0;
  const send = async (): Promise<"served" | "refused" | "other"> => {
    seq += 1;
    const res = await fetch(`${handle.url}/v1/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-caller-id": "rollback-drill",
        "x-request-id": `drill-${seq}`,
      },
      body: JSON.stringify({ target: "stub", request: PROBE_REQUEST }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      violation?: { policy?: string };
    } | null;
    if (res.status === 200 && body?.ok) return "served";
    if (res.status === 503 && body?.violation?.policy === "kill-switch") return "refused";
    return "other";
  };

  const cliEnv = { RELIABILITY_DECISION_LOG: logPath };
  const halt = () =>
    opts.cli
      ? runCommand(
          [
            ...opts.cli,
            "gateway",
            "halt",
            "--by",
            opts.actor,
            "--reason",
            reason,
            "--halt-file",
            operatorHaltFile,
            "--log",
            logPath,
          ],
          cliEnv,
        )
      : haltGateway({ by: opts.actor, reason, haltFile: operatorHaltFile, decisionLog: log }).then(
          () => undefined,
        );
  const resume = () =>
    opts.cli
      ? runCommand(
          [
            ...opts.cli,
            "gateway",
            "resume",
            "--by",
            opts.actor,
            "--reason",
            "rollback drill complete",
            "--halt-file",
            operatorHaltFile,
            "--log",
            logPath,
          ],
          cliEnv,
        )
      : resumeGateway({
          by: opts.actor,
          reason: "rollback drill complete",
          haltFile: operatorHaltFile,
          decisionLog: log,
        }).then(() => undefined);

  const haltCommand = `reliability gateway halt --by ${opts.actor} --reason "${reason}"${
    opts.cli
      ? ` (run as: ${opts.cli.map((a) => (isAbsolute(a) ? relative(process.cwd(), a) || a : a)).join(" ")})`
      : " (in-process haltGateway)"
  }`;

  try {
    if ((await send()) !== "served")
      throw new Error("the drill gateway did not serve before the halt");

    // Pull the switch and keep sending until the first refusal (or the deadline).
    const t0 = performance.now();
    let haltDone = 0;
    const haltRun = halt().then(() => {
      haltDone = performance.now();
    });
    let firstRefusal: number | null = null;
    let servedWhileHalting = 0;
    const deadline = t0 + thresholdMs * 3;
    while (performance.now() < deadline) {
      const r = await send();
      if (r === "refused") {
        firstRefusal = performance.now();
        break;
      }
      if (r === "served") servedWhileHalting += 1;
    }
    await haltRun;
    const haltCommandMs = haltDone - t0;

    // After the halt took effect (or, if it never did, after the command returned),
    // every probe must be refused and the provider must not be called.
    const callsBefore = calls.length;
    let requestsRefused = 0;
    for (let i = 0; i < probes; i++) {
      if ((await send()) === "refused") requestsRefused += 1;
    }
    const providerCallsAfterHalt = calls.length - callsBefore;

    await resume();
    const callsBeforeResume = calls.length;
    const resumeRestored = (await send()) === "served" && calls.length > callsBeforeResume;

    const records = await readDecisionLog(logPath);
    const decisionLog = {
      halt: records.filter((r) => isControlRecord(r) && r.action === "halt").length,
      resume: records.filter((r) => isControlRecord(r) && r.action === "resume").length,
      killSwitchRefusals: records.filter((r) => !isControlRecord(r) && r.policy === "kill-switch")
        .length,
    };

    const timeToHaltMs = firstRefusal === null ? null : Math.round((firstRefusal - t0) * 10) / 10;
    const passed =
      timeToHaltMs !== null &&
      timeToHaltMs <= thresholdMs &&
      providerCallsAfterHalt === 0 &&
      requestsRefused === probes &&
      resumeRestored &&
      decisionLog.halt === 1 &&
      decisionLog.resume === 1 &&
      decisionLog.killSwitchRefusals === probes + 1;

    return DrillRecordSchema.parse({
      v: 1,
      kind: "kill-switch-drill",
      date: startedAt.toISOString().slice(0, 10),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      actor: opts.actor,
      reason,
      target: "stub-backed gateway over HTTP (counting provider)",
      trigger: "halt-file",
      haltCommand,
      thresholdMs,
      timeToHaltMs,
      haltCommandMs: Math.round(haltCommandMs * 10) / 10,
      servedWhileHalting,
      probes,
      requestsRefused,
      providerCallsAfterHalt,
      resumeRestored,
      decisionLog,
      release: opts.release,
      degraded,
      passed,
    });
  } finally {
    await handle.stop();
  }
}
