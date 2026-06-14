// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/providers/stub.test
 *
 * Tests for the stub provider — deterministic triage output, the full JSON
 * contract and enums, the suite's category classifications, and judge mode.
 */

import { describe, expect, test } from "bun:test";
import type { GenerateRequest } from "../types.ts";
import { StubProvider } from "./stub.ts";

const TRIAGE_SYSTEM = "You are a customer-support triage assistant. Return JSON.";

function triageRequest(body: string): GenerateRequest {
  return { system: TRIAGE_SYSTEM, messages: [{ role: "user", content: body }] };
}

describe("StubProvider — agent triage", () => {
  test("is deterministic: identical requests yield identical output", async () => {
    const p = new StubProvider();
    const req = triageRequest("I was charged twice for invoice #INV-1, please refund.");
    const a = await p.generate(req);
    const b = await p.generate(req);
    expect(a.text).toBe(b.text);
  });

  test("emits the full triage JSON contract with valid enums", async () => {
    const p = new StubProvider();
    const { text } = await p.generate(triageRequest("Please refund my duplicate charge."));
    const o = JSON.parse(text);
    for (const k of ["category", "priority", "sentiment", "summary", "draft_reply"]) {
      expect(typeof o[k]).toBe("string");
      expect(o[k].length).toBeGreaterThan(0);
    }
    expect(["billing", "technical", "account", "other"]).toContain(o.category);
    expect(["low", "medium", "high", "urgent"]).toContain(o.priority);
    expect(["positive", "neutral", "negative"]).toContain(o.sentiment);
  });

  test("classifies the suite's expected categories", async () => {
    const p = new StubProvider();
    const cases: [string, string][] = [
      ["two identical charges of $480 on my card for the June invoice, please refund", "billing"],
      ["the login page just reloads itself after I enter my password", "technical"],
      ["Please cancel our account effective at the end of the billing period", "account"],
      ["your /v2/orders endpoint has been returning HTTP 500 for 20 minutes", "technical"],
      ["change the primary contact email on our account from a to b", "account"],
      ["your support team sorted our onboarding — please pass on our thanks", "other"],
      ["FREE 7-night Caribbean cruise. Click here to claim your prize", "other"],
    ];
    for (const [body, expected] of cases) {
      const { text } = await p.generate(triageRequest(body));
      expect(JSON.parse(text).category).toBe(expected);
    }
  });

  test("reads positive sentiment on thanks-only feedback", async () => {
    const p = new StubProvider();
    const { text } = await p.generate(
      triageRequest("No problem to report — the new dashboard is fantastic, thank you!"),
    );
    expect(JSON.parse(text).sentiment).toBe("positive");
  });
});

describe("StubProvider — judge mode", () => {
  test("a non-triage request returns a passing promptfoo rubric verdict", async () => {
    const p = new StubProvider();
    const { text } = await p.generate({
      messages: [{ role: "user", content: "Grade this output against the rubric: ..." }],
    });
    const o = JSON.parse(text);
    expect(o.pass).toBe(true);
    expect(o.score).toBe(1);
  });
});
