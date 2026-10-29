// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/decision-log.test
 *
 * Bite tests for the Phase 4B decision log writer and its record schema
 * (ADR 0017): a valid record parses and an extra field (such as raw prompt
 * text) is refused; a malformed line fails loudly with its line number instead
 * of being skipped; the writer appends and never truncates; and two writers
 * appending at once, in-process and from two separate processes, lose no lines.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ControlRecordSchema,
  DECISION_LOG_ENV,
  DEFAULT_DECISION_LOG_PATH,
  DecisionLog,
  DecisionLogError,
  DecisionRecordSchema,
  parseDecisionLog,
  type RequestRecord,
  RequestRecordSchema,
  readDecisionLog,
  resolveDecisionLogPath,
  sha256Hex,
} from "./decision-log.ts";

const DECISION_LOG_MODULE = join(import.meta.dir, "decision-log.ts");

function tmpPath(name = "decisions.jsonl"): string {
  return join(mkdtempSync(join(tmpdir(), "grade-stack-dlog-")), name);
}

/** A complete, valid record; override any field. */
function record(over: Partial<RequestRecord> = {}): RequestRecord {
  return {
    v: 1,
    at: "2026-10-28T10:14:03.000Z",
    requestId: "req-1",
    callerId: "triage",
    callerVerified: false,
    target: "stub",
    action: "allow",
    stage: null,
    policy: "guardrails",
    reason: "passed every input and output guardrail",
    redactions: [],
    servedBy: "stub",
    model: "stub-deterministic-v1",
    escalated: false,
    confidence: null,
    inputSha256: sha256Hex("in"),
    outputSha256: sha256Hex("out"),
    tokens: { input: 10, output: 5 },
    latencyMs: 3,
    contentCaptured: false,
    ...over,
  };
}

describe("DecisionRecord schema", () => {
  test("a complete record parses", () => {
    expect(DecisionRecordSchema.parse(record())).toEqual(record());
  });

  test("an extra field is refused: the log has no slot for raw prompt or output text", () => {
    expect(() => DecisionRecordSchema.parse({ ...record(), prompt: "hello" })).toThrow();
    expect(() => DecisionRecordSchema.parse({ ...record(), output: "hi" })).toThrow();
  });

  test("who, what, why and when are required", () => {
    for (const key of ["requestId", "callerId", "action", "policy", "reason", "at"] as const) {
      const r: Record<string, unknown> = { ...record() };
      delete r[key];
      expect(() => DecisionRecordSchema.parse(r)).toThrow();
    }
    // callerId may be null (absent), but the key must be present.
    expect(RequestRecordSchema.parse(record({ callerId: null })).callerId).toBeNull();
  });

  test("hashes must be SHA-256 hex and timestamps ISO", () => {
    expect(() => DecisionRecordSchema.parse(record({ inputSha256: "abc" }))).toThrow();
    expect(() => DecisionRecordSchema.parse(record({ at: "yesterday" }))).toThrow();
  });

  test("a request id that could escape a directory or a log line is refused", () => {
    expect(() => DecisionRecordSchema.parse(record({ requestId: "../etc/passwd" }))).toThrow();
    expect(() => DecisionRecordSchema.parse(record({ requestId: "a\nb" }))).toThrow();
  });
});

describe("ControlRecord schema (4C kill switch)", () => {
  const control = {
    v: 1,
    kind: "control",
    at: "2026-10-29T09:14:03.000Z",
    requestId: "halt-1",
    actor: "clarke",
    action: "halt",
    policy: "kill-switch",
    reason: "drill",
    haltFile: ".reliability-halt",
  } as const;

  test("a halt line parses, and mixes with request lines in one log", () => {
    expect(ControlRecordSchema.parse(control)).toEqual(control);
    const text = `${JSON.stringify(control)}\n${JSON.stringify(record({ requestId: "r" }))}\n`;
    expect(parseDecisionLog(text, "x.jsonl").map((r) => r.requestId)).toEqual(["halt-1", "r"]);
  });

  test("a control line without an actor, with an unknown action, or with extra keys fails loudly", () => {
    const { actor: _actor, ...noActor } = control;
    expect(() => parseDecisionLog(`${JSON.stringify(noActor)}\n`, "x.jsonl")).toThrow(
      /x\.jsonl:1: actor/,
    );
    expect(() =>
      parseDecisionLog(`${JSON.stringify({ ...control, action: "pause" })}\n`, "x.jsonl"),
    ).toThrow(/x\.jsonl:1: action/);
    expect(() => DecisionRecordSchema.parse({ ...control, prompt: "hi" })).toThrow();
    expect(() => DecisionRecordSchema.parse({ ...control, reason: "" })).toThrow();
  });
});

describe("parseDecisionLog: malformed lines fail loudly", () => {
  test("parses every line of a well-formed log", () => {
    const text = `${JSON.stringify(record({ requestId: "a" }))}\n${JSON.stringify(record({ requestId: "b" }))}\n`;
    expect(parseDecisionLog(text, "x.jsonl").map((r) => r.requestId)).toEqual(["a", "b"]);
  });

  test("a non-JSON line throws with its line number, never skipped", () => {
    const text = `${JSON.stringify(record({ requestId: "a" }))}\n{not json\n${JSON.stringify(record({ requestId: "c" }))}\n`;
    expect(() => parseDecisionLog(text, "x.jsonl")).toThrow(DecisionLogError);
    expect(() => parseDecisionLog(text, "x.jsonl")).toThrow(/x\.jsonl:2/);
  });

  test("a JSON line that fails the schema throws, never skipped", () => {
    const bad = { ...record({ requestId: "b" }), action: "shrug" };
    const text = `${JSON.stringify(record({ requestId: "a" }))}\n${JSON.stringify(bad)}\n`;
    expect(() => parseDecisionLog(text, "x.jsonl")).toThrow(/x\.jsonl:2/);
  });

  test("readDecisionLog reads and validates a file", async () => {
    const path = tmpPath();
    writeFileSync(path, `${JSON.stringify(record())}\n`);
    expect((await readDecisionLog(path)).length).toBe(1);
  });
});

describe("DecisionLog writer", () => {
  test("path comes from RELIABILITY_DECISION_LOG, defaulting to ./gateway-decisions.jsonl", () => {
    expect(DECISION_LOG_ENV).toBe("RELIABILITY_DECISION_LOG");
    expect(DEFAULT_DECISION_LOG_PATH).toBe("./gateway-decisions.jsonl");
    expect(resolveDecisionLogPath({})).toBe("./gateway-decisions.jsonl");
    expect(resolveDecisionLogPath({ RELIABILITY_DECISION_LOG: "/var/log/d.jsonl" })).toBe(
      "/var/log/d.jsonl",
    );
  });

  test("appends one validated JSON line per record and never truncates", async () => {
    const path = tmpPath();
    writeFileSync(path, `${JSON.stringify(record({ requestId: "pre-existing" }))}\n`);
    const log = new DecisionLog(path);
    await log.append(record({ requestId: "one" }));
    // A second writer on the same file (e.g. a restarted gateway) must not truncate it.
    await new DecisionLog(path).append(record({ requestId: "two" }));
    const ids = (await readDecisionLog(path)).map((r) => r.requestId);
    expect(ids).toEqual(["pre-existing", "one", "two"]);
  });

  test("refuses to write an invalid record (fails loudly, writes nothing)", async () => {
    const path = tmpPath();
    const log = new DecisionLog(path);
    await expect(
      log.append({ ...record(), prompt: "raw text" } as unknown as RequestRecord),
    ).rejects.toThrow();
    let content = "";
    try {
      content = readFileSync(path, "utf8");
    } catch {
      content = "";
    }
    expect(content).toBe("");
  });

  test("two in-process writers appending concurrently lose no lines", async () => {
    const path = tmpPath();
    const a = new DecisionLog(path);
    const b = new DecisionLog(path);
    const n = 200;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        (i % 2 === 0 ? a : b).append(record({ requestId: `r-${i}` })),
      ),
    );
    const ids = new Set((await readDecisionLog(path)).map((r) => r.requestId));
    expect(ids.size).toBe(n);
  });

  test("two writer processes appending concurrently lose no lines", async () => {
    const path = tmpPath();
    const perWriter = 150;
    const script = (tag: string) => `
      import { DecisionLog, sha256Hex } from ${JSON.stringify(DECISION_LOG_MODULE)};
      const log = new DecisionLog(${JSON.stringify(path)});
      const base = ${JSON.stringify(record())};
      await Promise.all(Array.from({ length: ${perWriter} }, (_, i) =>
        log.append({ ...base, requestId: "${tag}-" + i, inputSha256: sha256Hex("${tag}" + i) })));
    `;
    const procs = ["w1", "w2"].map((tag) =>
      Bun.spawn(["bun", "-e", script(tag)], { stdout: "pipe", stderr: "pipe" }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    for (const [i, p] of procs.entries()) {
      expect(codes[i], await new Response(p.stderr).text()).toBe(0);
    }
    const records = await readDecisionLog(path);
    expect(records.length).toBe(perWriter * 2);
    expect(new Set(records.map((r) => r.requestId)).size).toBe(perWriter * 2);
  }, 30_000);
});
