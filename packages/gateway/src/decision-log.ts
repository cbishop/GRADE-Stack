// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/decision-log
 *
 * The gateway decision log (Phase 4B, ADR 0017): one append-only JSONL line per
 * `generate` call saying who asked, what the gateway decided, which policy fired
 * and why, and when, with SHA-256 hashes of the input and output instead of the
 * text. `DecisionRecordSchema` is strict, so a record has no slot for raw prompt
 * or output text, and a malformed line fails loudly on read instead of being
 * skipped. The file is opened append-only (`O_APPEND`) and never truncated by
 * the stack; retention is the deployer's policy (`docs/logging-and-retention.md`).
 *
 * Phase 4C (ADR 0018) adds a second record kind to the same log: a `control`
 * line for each operator halt or resume of the kill switch, naming the actor,
 * the action, the reason and the time. A request line has no `kind` field, so
 * every 4B log still reads unchanged.
 */

import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { IDENTITY_ID_PATTERN } from "@grade-stack/core";
import { z } from "zod";

/** Env naming the decision log file. */
export const DECISION_LOG_ENV = "RELIABILITY_DECISION_LOG";
/** Default decision log path, relative to the gateway's working directory. */
export const DEFAULT_DECISION_LOG_PATH = "./gateway-decisions.jsonl";

const Id = z.string().regex(IDENTITY_ID_PATTERN);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Provider = z.enum(["bedrock", "ollama", "stub"]);

/** One gateway request decision. Strict: unknown keys (such as raw text) are refused. */
export const RequestRecordSchema = z.strictObject({
  v: z.literal(1),
  at: z.iso.datetime(),
  requestId: Id,
  callerId: Id.nullable(),
  callerVerified: z.boolean(),
  sessionId: Id.optional(),
  target: Provider,
  action: z.enum(["allow", "redact", "block", "error"]),
  stage: z.enum(["input", "output"]).nullable(),
  policy: z.string().min(1),
  reason: z.string().min(1),
  redactions: z.array(z.string()),
  servedBy: Provider.nullable(),
  model: z.string().nullable(),
  escalated: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  inputSha256: Sha256,
  outputSha256: Sha256.nullable(),
  tokens: z.strictObject({ input: z.number().int().min(0), output: z.number().int().min(0) }),
  latencyMs: z.number().min(0),
  contentCaptured: z.boolean(),
});

/** A validated request decision (one per `generate` call). */
export type RequestRecord = z.infer<typeof RequestRecordSchema>;

/**
 * One operator action on the kill switch (Phase 4C): who halted or resumed the
 * gateway, why, and when. `requestId` identifies the operator action itself so
 * `gateway log --request` finds it like any other line.
 */
export const ControlRecordSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("control"),
  at: z.iso.datetime(),
  requestId: Id,
  actor: Id,
  action: z.enum(["halt", "resume"]),
  policy: z.literal("kill-switch"),
  reason: z.string().min(1).max(500),
  haltFile: z.string().min(1),
});

/** A validated kill-switch control record. */
export type ControlRecord = z.infer<typeof ControlRecordSchema>;

/** Any decision-log line: a request decision or a kill-switch control action. */
export const DecisionRecordSchema = z.union([RequestRecordSchema, ControlRecordSchema]);

/** A validated decision-log record. */
export type DecisionRecord = RequestRecord | ControlRecord;

/** True for a kill-switch control line (halt or resume). */
export function isControlRecord(r: DecisionRecord): r is ControlRecord {
  return "kind" in r && r.kind === "control";
}

/** The schema a raw line must satisfy: chosen by its `kind`, so errors name the real field. */
function schemaFor(json: unknown) {
  const kind =
    typeof json === "object" && json !== null ? (json as { kind?: unknown }).kind : undefined;
  return kind === undefined ? RequestRecordSchema : ControlRecordSchema;
}

/** Thrown when a log line is not valid JSON or fails the schema. Never swallowed. */
export class DecisionLogError extends Error {
  override name = "DecisionLogError";
}

/** Lower-case hex SHA-256 of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The decision log path: `RELIABILITY_DECISION_LOG`, else the default. */
export function resolveDecisionLogPath(env: Record<string, string | undefined> = process.env) {
  const v = env[DECISION_LOG_ENV];
  return v && v.length > 0 ? v : DEFAULT_DECISION_LOG_PATH;
}

/**
 * Append-only writer. Each record is validated, then written as one line in a
 * single `O_APPEND` write, so concurrent writers (requests or processes) never
 * interleave or lose lines. There is no truncate or rewrite path.
 */
export class DecisionLog {
  constructor(readonly path: string = resolveDecisionLogPath()) {}

  async append(record: DecisionRecord): Promise<void> {
    const line = `${JSON.stringify(schemaFor(record).parse(record))}\n`;
    await appendFile(this.path, line, { flag: "a", encoding: "utf8" });
  }
}

/** Parse JSONL text into records; any bad line throws with `source:line`. */
export function parseDecisionLog(text: string, source: string): DecisionRecord[] {
  const records: DecisionRecord[] = [];
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new DecisionLogError(`${source}:${i + 1}: not valid JSON`);
    }
    const parsed = schemaFor(json).safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DecisionLogError(
        `${source}:${i + 1}: ${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
      );
    }
    records.push(parsed.data);
  }
  return records;
}

/** Read and validate a decision log file. */
export async function readDecisionLog(path: string): Promise<DecisionRecord[]> {
  return parseDecisionLog(await readFile(path, "utf8"), path);
}
