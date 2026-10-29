// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/kill-switch
 *
 * The gateway kill switch (Phase 4C, ADR 0018). Two triggers, both read on every
 * request so a running gateway halts without a restart:
 *
 *   - `RELIABILITY_HALT=1` in the gateway's environment (process-level);
 *   - a halt file (`RELIABILITY_HALT_FILE`, default `.reliability-halt`) holding
 *     `{ by, reason, at }`, written by `reliability gateway halt`.
 *
 * `GatewayService.generate` checks {@link readHaltState} before anything else,
 * so a halted gateway resolves no provider and makes no model call. A halt file
 * that is not a valid halt record fails closed: the gateway stays halted and
 * says the file is malformed. `haltGateway` and `resumeGateway` write and remove
 * the file and append a `control` line to the decision log naming the actor,
 * the action, the reason and the time.
 */

import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { IDENTITY_ID_PATTERN } from "@grade-stack/core";
import { z } from "zod";
import { type ControlRecord, DecisionLog } from "./decision-log.ts";

/** Env that halts the gateway process while set to `1` or `true`. */
export const HALT_ENV = "RELIABILITY_HALT";
/** Env naming the halt file. */
export const HALT_FILE_ENV = "RELIABILITY_HALT_FILE";
/** Default halt file, relative to the gateway's working directory. */
export const DEFAULT_HALT_FILE = ".reliability-halt";

/** The halt file's contents. Strict: unknown keys are refused. */
export const HaltRecordSchema = z.strictObject({
  by: z.string().regex(IDENTITY_ID_PATTERN),
  reason: z.string().min(1).max(500),
  at: z.iso.datetime(),
});

/** A validated halt record. */
export type HaltRecord = z.infer<typeof HaltRecordSchema>;

/** Thrown when a halt file is not valid JSON or fails the schema. */
export class HaltFileError extends Error {
  override name = "HaltFileError";
}

/** Whether the gateway is halted, and why, as a reason safe to return to callers. */
export type HaltState =
  | { halted: false }
  | { halted: true; trigger: "env" | "file"; reason: string; record?: HaltRecord };

/** The halt file path: `RELIABILITY_HALT_FILE`, else the default. */
export function resolveHaltFilePath(env: Record<string, string | undefined> = process.env) {
  const v = env[HALT_FILE_ENV];
  return v && v.length > 0 ? v : DEFAULT_HALT_FILE;
}

/** Parse a halt file's text; throws {@link HaltFileError} naming the source. */
export function parseHaltRecord(text: string, source: string): HaltRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HaltFileError(`${source}: not valid JSON`);
  }
  const parsed = HaltRecordSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HaltFileError(
      `${source}: ${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** Read the halt file; null when it does not exist. Malformed contents throw. */
export async function readHaltRecord(haltFile: string): Promise<HaltRecord | null> {
  let text: string;
  try {
    text = await readFile(haltFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseHaltRecord(text, haltFile);
}

/**
 * The per-request check. The env trigger wins; then the halt file. Any error
 * reading the file (malformed, unreadable) counts as halted: fail closed.
 */
export async function readHaltState(
  haltFile: string,
  env: Record<string, string | undefined> = process.env,
): Promise<HaltState> {
  const v = env[HALT_ENV]?.toLowerCase();
  if (v === "1" || v === "true") {
    return {
      halted: true,
      trigger: "env",
      reason: `${HALT_ENV}=1 is set on the gateway process; restart it without the variable to resume`,
    };
  }
  try {
    const record = await readHaltRecord(haltFile);
    if (record === null) return { halted: false };
    return {
      halted: true,
      trigger: "file",
      record,
      reason: `gateway halted by ${record.by} at ${record.at}: ${record.reason}`,
    };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      halted: true,
      trigger: "file",
      reason: `halt file is malformed or unreadable (${why}); refusing until it is fixed or removed`,
    };
  }
}

/** Common options for {@link haltGateway} and {@link resumeGateway}. */
export interface KillSwitchActionOptions {
  /** Who pulled (or released) the switch; recorded as the actor. */
  by: string;
  /** Why; recorded verbatim (max 500 characters). */
  reason?: string;
  /** Halt file; defaults to `RELIABILITY_HALT_FILE`, else `.reliability-halt`. */
  haltFile?: string;
  /** Decision log; defaults to `RELIABILITY_DECISION_LOG`, else `./gateway-decisions.jsonl`. */
  decisionLog?: DecisionLog;
  /** Clock, for tests. */
  now?: Date;
}

export type HaltResult =
  | { status: "halted"; record: HaltRecord; haltFile: string; logLine: ControlRecord }
  | { status: "already-halted"; record: HaltRecord; haltFile: string };

export type ResumeResult =
  | { status: "resumed"; previous: HaltRecord | null; haltFile: string; logLine: ControlRecord }
  | { status: "not-halted"; haltFile: string };

function controlLine(
  action: "halt" | "resume",
  by: string,
  reason: string,
  at: string,
  haltFile: string,
): ControlRecord {
  return {
    v: 1,
    kind: "control",
    at,
    requestId: `${action}-${randomUUID()}`,
    actor: by,
    action,
    policy: "kill-switch",
    reason,
    haltFile,
  };
}

/**
 * Pull the kill switch: write the halt file (atomically, via rename) and log a
 * `halt` control line. A gateway that is already halted keeps the first record,
 * so the log names whoever actually stopped it.
 */
export async function haltGateway(opts: KillSwitchActionOptions): Promise<HaltResult> {
  const haltFile = opts.haltFile ?? resolveHaltFilePath();
  const log = opts.decisionLog ?? new DecisionLog();
  const existing = await readHaltRecord(haltFile).catch(() => null);
  if (existing) return { status: "already-halted", record: existing, haltFile };

  const record = HaltRecordSchema.parse({
    by: opts.by,
    reason: opts.reason ?? "no reason given",
    at: (opts.now ?? new Date()).toISOString(),
  });
  const tmp = `${haltFile}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record)}\n`, "utf8");
  await rename(tmp, haltFile);
  const logLine = controlLine("halt", record.by, record.reason, record.at, haltFile);
  await log.append(logLine);
  return { status: "halted", record, haltFile, logLine };
}

/**
 * Release the kill switch: remove the halt file and log a `resume` control line.
 * A malformed halt file is removed too (it was halting the gateway). The env
 * trigger cannot be cleared from here; the gateway must restart without it.
 */
export async function resumeGateway(opts: KillSwitchActionOptions): Promise<ResumeResult> {
  const haltFile = opts.haltFile ?? resolveHaltFilePath();
  const log = opts.decisionLog ?? new DecisionLog();
  let previous: HaltRecord | null;
  try {
    previous = await readHaltRecord(haltFile);
    if (previous === null) return { status: "not-halted", haltFile };
  } catch {
    previous = null;
  }
  const at = (opts.now ?? new Date()).toISOString();
  const reason = opts.reason ?? "operator resumed service";
  // Log first: if the line cannot be written, the gateway stays halted.
  const logLine = controlLine("resume", opts.by, reason, at, haltFile);
  await log.append(logLine);
  await rm(haltFile, { force: true });
  return { status: "resumed", previous, haltFile, logLine };
}
