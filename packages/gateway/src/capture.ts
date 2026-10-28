// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/capture
 *
 * Opt-in content capture (Phase 4B, ADR 0017). When `RELIABILITY_TRACE_CONTENT=1`
 * the gateway mirrors each request's input and returned output to one JSON file
 * per request id under `RELIABILITY_CAPTURE_DIR`, so a decision-log line (which
 * holds only hashes) can be reconstructed. It holds what the caller sent and what
 * the gateway returned, after output redaction, never the raw pre-redaction model
 * text. Capture is local only and off by default. Phase 4F re-scores it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IDENTITY_ID_PATTERN } from "@grade-stack/core";
import { z } from "zod";

/** Env naming the capture directory. */
export const CAPTURE_DIR_ENV = "RELIABILITY_CAPTURE_DIR";
/** Default capture directory, relative to the gateway's working directory. */
export const DEFAULT_CAPTURE_DIR = "./gateway-captures";

/** One captured request: the content behind a decision-log line. */
export const CaptureRecordSchema = z.strictObject({
  v: z.literal(1),
  requestId: z.string().regex(IDENTITY_ID_PATTERN),
  callerId: z.string().nullable(),
  at: z.iso.datetime(),
  target: z.string(),
  request: z.strictObject({
    system: z.string().optional(),
    messages: z.array(z.strictObject({ role: z.string(), content: z.string() })),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
  }),
  /** What the caller received (post-redaction), or null when nothing was returned. */
  output: z.string().nullable(),
});

/** A validated capture record. */
export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

/** The capture directory: `RELIABILITY_CAPTURE_DIR`, else the default. */
export function resolveCaptureDir(env: Record<string, string | undefined> = process.env): string {
  const v = env[CAPTURE_DIR_ENV];
  return v && v.length > 0 ? v : DEFAULT_CAPTURE_DIR;
}

/**
 * Write one capture as `<dir>/<requestId>.json`. Never overwrites: a reused
 * request id gets a numbered sibling (`<id>.2.json`). Returns the path written.
 */
export async function writeCapture(dir: string, record: CaptureRecord): Promise<string> {
  const valid = CaptureRecordSchema.parse(record);
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify(valid, null, 2)}\n`;
  for (let n = 1; ; n++) {
    const path = join(dir, n === 1 ? `${valid.requestId}.json` : `${valid.requestId}.${n}.json`);
    try {
      await writeFile(path, body, { flag: "wx", encoding: "utf8" });
      return path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** Read and validate one capture file. */
export async function readCapture(path: string): Promise<CaptureRecord> {
  return CaptureRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
