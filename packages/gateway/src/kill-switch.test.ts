// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/kill-switch.test
 *
 * The bite test for the Phase 4C kill switch (ADR 0018). With a spy provider:
 *
 *   - after halt, `generate` returns `{ ok: false, violation: { policy:
 *     "kill-switch" } }` and the provider is never resolved or called, on both
 *     the plain forward path and the confidence-router path;
 *   - both triggers bite per request, without a restart: the halt file
 *     (`RELIABILITY_HALT_FILE`) and `RELIABILITY_HALT=1`;
 *   - the halt and the resume each write one decision-log line naming the actor,
 *     the action, the reason and the time; the refusal itself is one request line
 *     with policy `kill-switch`;
 *   - resume restores normal service on the same running service;
 *   - a malformed halt file fails closed and loudly (the schema refuses it, the
 *     gateway keeps refusing until it is fixed or removed);
 *   - over HTTP the client surfaces the refusal as a `GuardrailError`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GatewayProvider,
  type GenerateRequest,
  type GenerateResult,
  GuardrailError,
  type ModelProvider,
  type ProviderName,
} from "@grade-stack/core";
import { serveGateway } from "./connect.ts";
import { type ControlRecord, DecisionLog, readDecisionLog } from "./decision-log.ts";
import { describeDecision } from "./explain.ts";
import { GatewayService } from "./gateway.ts";
import {
  HALT_ENV,
  HaltFileError,
  HaltRecordSchema,
  haltGateway,
  parseHaltRecord,
  readHaltState,
  resumeGateway,
} from "./kill-switch.ts";
import { ConfidenceRouter } from "./router.ts";

/** A spy provider: counts resolutions and calls, answers with a fixed triage. */
function spy() {
  const counts = { resolved: 0, calls: 0 };
  const provider = (name: ProviderName): ModelProvider => ({
    name,
    model: "spy-model",
    generate(_req: GenerateRequest): Promise<GenerateResult> {
      counts.calls += 1;
      return Promise.resolve({
        text: '{"category":"billing","priority":"high","sentiment":"negative"}',
        usage: { inputTokens: 3, outputTokens: 5 },
        provider: name,
        model: "spy-model",
      });
    },
  });
  return {
    counts,
    resolveProvider: (target: ProviderName) => {
      counts.resolved += 1;
      return provider(target);
    },
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "grade-stack-halt-"));
  return {
    haltFile: join(dir, ".reliability-halt"),
    log: new DecisionLog(join(dir, "decisions.jsonl")),
  };
}

const BENIGN: GenerateRequest = {
  system: "You are a customer-support triage assistant.",
  messages: [{ role: "user", content: "I was charged twice for invoice 8812." }],
};

afterEach(() => {
  delete process.env[HALT_ENV];
});

describe("kill switch: halt file trigger", () => {
  test("after halt the plain forward path refuses with kill-switch and never calls the provider", async () => {
    const { haltFile, log } = fixture();
    const s = spy();
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      resolveProvider: s.resolveProvider,
    });

    await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
    const res = await svc.generate("stub", BENIGN, { requestId: "after-halt", callerId: "triage" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violation.policy).toBe("kill-switch");
      expect(res.violation.stage).toBe("input");
      expect(res.violation.reason).toContain("clarke");
      expect(res.violation.reason).toContain("drill");
    }
    expect(s.counts.resolved).toBe(0);
    expect(s.counts.calls).toBe(0);
  });

  test("the router path honours the halt: neither tier is resolved or called", async () => {
    const { haltFile, log } = fixture();
    const s = spy();
    const router = new ConfidenceRouter({
      samples: 3,
      threshold: 0.5,
      consensusFields: ["category", "priority", "sentiment"],
    });
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      router,
      resolveProvider: s.resolveProvider,
    });

    await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
    const res = await svc.generate("stub", BENIGN);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.violation.policy).toBe("kill-switch");
    expect(s.counts.resolved).toBe(0);
    expect(s.counts.calls).toBe(0);
  });

  test("halts a running service without restart, and resume restores it", async () => {
    const { haltFile, log } = fixture();
    const s = spy();
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      resolveProvider: s.resolveProvider,
    });

    const before = await svc.generate("stub", BENIGN);
    expect(before.ok).toBe(true);
    expect(s.counts.calls).toBe(1);

    await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
    const during = await svc.generate("stub", BENIGN);
    expect(during.ok).toBe(false);
    expect(s.counts.calls).toBe(1);

    const resumed = await resumeGateway({ by: "clarke", haltFile, decisionLog: log });
    expect(resumed.status).toBe("resumed");
    const after = await svc.generate("stub", BENIGN);
    expect(after.ok).toBe(true);
    expect(s.counts.calls).toBe(2);
  });

  test("halt and resume each write one decision-log line with actor, action, reason and time", async () => {
    const { haltFile, log } = fixture();
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      resolveProvider: spy().resolveProvider,
    });

    await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
    await svc.generate("stub", BENIGN, { requestId: "refused-1", callerId: "triage" });
    await resumeGateway({ by: "ops-oncall", reason: "drill complete", haltFile, decisionLog: log });

    const records = await readDecisionLog(log.path);
    expect(records.length).toBe(3);
    const [halt, refused, resume] = records;

    expect(halt).toMatchObject({
      kind: "control",
      action: "halt",
      actor: "clarke",
      reason: "drill",
    });
    expect(Number.isNaN(Date.parse((halt as ControlRecord).at))).toBe(false);
    expect(resume).toMatchObject({
      kind: "control",
      action: "resume",
      actor: "ops-oncall",
      reason: "drill complete",
    });

    // The refusal is itself one request line: who asked, kill-switch, no model.
    expect(refused).toMatchObject({
      requestId: "refused-1",
      callerId: "triage",
      action: "block",
      policy: "kill-switch",
      servedBy: null,
    });
  });

  test("a second halt while halted keeps the first record and writes no line", async () => {
    const { haltFile, log } = fixture();
    const first = await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
    expect(first.status).toBe("halted");
    const second = await haltGateway({
      by: "someone",
      reason: "again",
      haltFile,
      decisionLog: log,
    });
    expect(second.status).toBe("already-halted");
    expect(second.record.by).toBe("clarke");
    expect((await readDecisionLog(log.path)).length).toBe(1);
  });

  test("resume when not halted says so and writes no line", async () => {
    const { haltFile, log } = fixture();
    const res = await resumeGateway({ by: "clarke", haltFile, decisionLog: log });
    expect(res.status).toBe("not-halted");
  });
});

describe("kill switch: RELIABILITY_HALT=1 trigger", () => {
  test("the env trigger is read per request and refuses without a provider call", async () => {
    const { haltFile, log } = fixture();
    const s = spy();
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      resolveProvider: s.resolveProvider,
    });

    expect((await svc.generate("stub", BENIGN)).ok).toBe(true);
    process.env[HALT_ENV] = "1";
    const res = await svc.generate("stub", BENIGN);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violation.policy).toBe("kill-switch");
      expect(res.violation.reason).toContain(HALT_ENV);
    }
    expect(s.counts.calls).toBe(1);

    delete process.env[HALT_ENV];
    expect((await svc.generate("stub", BENIGN)).ok).toBe(true);
  });

  test("readHaltState reports the env trigger", async () => {
    const { haltFile } = fixture();
    expect((await readHaltState(haltFile, { [HALT_ENV]: "1" })).halted).toBe(true);
    expect((await readHaltState(haltFile, {})).halted).toBe(false);
  });
});

describe("kill switch: halt file schema", () => {
  test("a valid halt record parses", () => {
    const r = HaltRecordSchema.parse({
      by: "clarke",
      reason: "drill",
      at: "2026-10-29T09:14:00.000Z",
    });
    expect(r.by).toBe("clarke");
  });

  test("malformed halt records fail loudly", () => {
    expect(() => HaltRecordSchema.parse({ by: "clarke", reason: "drill" })).toThrow();
    expect(() =>
      HaltRecordSchema.parse({ by: "", reason: "drill", at: "2026-10-29T09:14:00.000Z" }),
    ).toThrow();
    expect(() =>
      HaltRecordSchema.parse({ by: "clarke", reason: "drill", at: "yesterday" }),
    ).toThrow();
    expect(() =>
      HaltRecordSchema.parse({
        by: "clarke",
        reason: "drill",
        at: "2026-10-29T09:14:00.000Z",
        extra: true,
      }),
    ).toThrow();
    expect(() => parseHaltRecord("not json", ".reliability-halt")).toThrow(HaltFileError);
  });

  test("a malformed halt file fails closed: the gateway keeps refusing, and says why", async () => {
    const { haltFile, log } = fixture();
    writeFileSync(haltFile, "{ this is not a halt record");
    const s = spy();
    const svc = new GatewayService({
      decisionLog: log,
      haltFile,
      resolveProvider: s.resolveProvider,
    });
    const res = await svc.generate("stub", BENIGN);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violation.policy).toBe("kill-switch");
      expect(res.violation.reason).toContain("malformed");
    }
    expect(s.counts.calls).toBe(0);
  });
});

describe("kill switch: explained in a sentence", () => {
  test("halt and resume lines read as plain sentences", async () => {
    const { haltFile, log } = fixture();
    await haltGateway({
      by: "clarke",
      reason: "drill",
      haltFile,
      decisionLog: log,
      now: new Date("2026-10-29T09:14:03.000Z"),
    });
    await resumeGateway({
      by: "clarke",
      haltFile,
      decisionLog: log,
      now: new Date("2026-10-29T09:20:00.000Z"),
    });
    const [halt, resume] = await readDecisionLog(log.path);
    // biome-ignore lint/style/noNonNullAssertion: both lines were just written.
    expect(describeDecision(halt!)).toBe(
      "Gateway halted by clarke at 2026-10-29 09:14:03 UTC: drill. No requests served until resume.",
    );
    // biome-ignore lint/style/noNonNullAssertion: both lines were just written.
    expect(describeDecision(resume!)).toContain(
      "Gateway resumed by clarke at 2026-10-29 09:20:00 UTC",
    );
  });
});

describe("kill switch over HTTP", () => {
  test("the client surfaces the refusal as a GuardrailError with policy kill-switch", async () => {
    const { haltFile, log } = fixture();
    const s = spy();
    const handle = serveGateway({ decisionLog: log, haltFile, resolveProvider: s.resolveProvider });
    try {
      const client = new GatewayProvider({ url: handle.url, target: "stub" });
      await haltGateway({ by: "clarke", reason: "drill", haltFile, decisionLog: log });
      const err = await client.generate(BENIGN).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GuardrailError);
      expect((err as GuardrailError).policy).toBe("kill-switch");
      expect(s.counts.calls).toBe(0);

      await resumeGateway({ by: "clarke", haltFile, decisionLog: log });
      const ok = await client.generate(BENIGN);
      expect(ok.text).toContain("billing");
    } finally {
      await handle.stop();
    }
  });
});
