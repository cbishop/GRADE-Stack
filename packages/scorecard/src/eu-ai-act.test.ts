// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/eu-ai-act.test
 *
 * Tests for the EU AI Act deployer-module parser and readiness reducer — the
 * "no readiness without evidence" enforcement (scored supported/partial must name
 * a mechanism), the weighted readiness reduction over scored obligations, and that
 * the committed governance module is itself valid.
 */

import { describe, expect, test } from "bun:test";
import { computeGovernanceReadiness, type EuAiActModule, parseEuAiActModule } from "./eu-ai-act.ts";

const COMMITTED_PATH = `${import.meta.dir}/../../../governance/eu-ai-act/eu-ai-act-deployer-2026.json`;

type Ob = EuAiActModule["obligations"][number];

function obligation(over: Partial<Ob> = {}): Ob {
  return {
    id: over.id ?? "Art X",
    title: over.title ?? "t",
    owner: over.owner ?? "deployer",
    applicability: over.applicability ?? "in-force",
    effectiveDate: over.effectiveDate ?? "2025-02-02",
    deferralNote: over.deferralNote,
    penaltyTier: over.penaltyTier ?? "Tier 2",
    scored: over.scored ?? true,
    stackSupport: over.stackSupport ?? "supported",
    mechanisms: over.mechanisms ?? [{ name: "m", ref: "r", note: "n" }],
    note: over.note ?? "a note",
  };
}

function makeModule(obligations: Ob[]): EuAiActModule {
  return {
    framework: "EU Artificial Intelligence Act",
    regulation: "Regulation (EU) 2024/1689",
    lens: "deployer",
    enteredIntoForce: "2024-08-01",
    retrievedAt: "2026-06-24",
    sourceUrl: "https://artificialintelligenceact.eu/",
    scope: "test",
    omnibusStatus: {
      name: "Digital Omnibus",
      stage: "provisional",
      legalEffect: "none yet",
      ifAdopted: ["x"],
    },
    penaltyTiers: [
      { tier: "Tier 1", cap: "€35M/7%", appliesTo: "Art 5" },
      { tier: "Tier 2", cap: "€15M/3%", appliesTo: "Art 26" },
      { tier: "Tier 3", cap: "€7.5M/1%", appliesTo: "misleading info" },
    ],
    penaltyNote: "do not conflate",
    statusLegend: { supported: "s", partial: "p", "deployer-owned": "d" },
    applicabilityLegend: { "in-force": "now" },
    obligations,
    scoreWeights: { supported: 1, partial: 0.5, "deployer-owned": 0 },
  };
}

describe("parseEuAiActModule — no readiness without evidence", () => {
  test("accepts a well-formed module", () => {
    expect(() => parseEuAiActModule(makeModule([obligation()]))).not.toThrow();
  });

  test("rejects a scored supported/partial obligation with no mechanism", () => {
    const raw = makeModule([obligation({ scored: true, stackSupport: "partial", mechanisms: [] })]);
    expect(() => parseEuAiActModule(raw)).toThrow();
  });

  test("allows a scored deployer-owned obligation with no mechanism", () => {
    const raw = makeModule([
      obligation({ scored: true, stackSupport: "deployer-owned", mechanisms: [] }),
    ]);
    expect(() => parseEuAiActModule(raw)).not.toThrow();
  });

  test("requires exactly three penalty tiers", () => {
    const raw = makeModule([obligation()]);
    raw.penaltyTiers = raw.penaltyTiers.slice(0, 2);
    expect(() => parseEuAiActModule(raw)).toThrow();
  });

  test("rejects an unknown applicability value", () => {
    const raw = makeModule([obligation()]);
    raw.obligations = raw.obligations.map((o) => ({
      ...o,
      applicability: "someday" as unknown as typeof o.applicability,
    }));
    expect(() => parseEuAiActModule(raw)).toThrow();
  });
});

describe("computeGovernanceReadiness — weighted over scored obligations", () => {
  test("only scored obligations count toward the score", () => {
    const mod = parseEuAiActModule(
      makeModule([
        obligation({ id: "A", scored: true, stackSupport: "supported" }),
        obligation({ id: "B", scored: true, stackSupport: "partial" }),
        // provider-only context entry, not scored — must not drag the score
        obligation({ id: "C", scored: false, stackSupport: "deployer-owned", mechanisms: [] }),
      ]),
    );
    const r = computeGovernanceReadiness(mod);
    expect(r.scoredCount).toBe(2);
    expect(r.total).toBe(3);
    expect(r.score).toBeCloseTo(0.75, 5); // (1 + 0.5) / 2
  });

  test("collects in-force ids and deployer-owned (scored) ids for the evidence trail", () => {
    const mod = parseEuAiActModule(
      makeModule([
        obligation({ id: "Art 5", applicability: "in-force", stackSupport: "partial" }),
        obligation({ id: "Art 50", applicability: "from-2026-08-02", stackSupport: "partial" }),
        obligation({
          id: "Art 26",
          applicability: "conditional-high-risk",
          stackSupport: "supported",
        }),
        obligation({
          id: "Art 27",
          applicability: "conditional-high-risk",
          scored: true,
          stackSupport: "deployer-owned",
          mechanisms: [],
        }),
      ]),
    );
    const r = computeGovernanceReadiness(mod);
    expect(r.inForceNowIds).toEqual(["Art 5", "Art 50"]);
    expect(r.deployerOwnedIds).toEqual(["Art 27"]);
    expect(r.omnibusStage).toContain("provisional");
  });
});

describe("committed governance module", () => {
  test("is valid and yields an evidence-backed readiness summary", async () => {
    const raw = await Bun.file(COMMITTED_PATH).json();
    const mod = parseEuAiActModule(raw);
    expect(mod.regulation).toBe("Regulation (EU) 2024/1689");
    expect(mod.penaltyTiers).toHaveLength(3);

    const r = computeGovernanceReadiness(mod);
    expect(r.scoredCount).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.supported + r.partial + r.deployerOwned).toBe(r.scoredCount);
  });
});
