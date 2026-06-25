// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/nist.test
 *
 * Tests for the NIST AI RMF mapping parser — the "no silent omissions"
 * enforcement (all 19 categories, supported/partial name a mechanism, every
 * category states a note) and that the committed mapping is itself valid and
 * classifies all 19 AI RMF categories.
 */

import { describe, expect, test } from "bun:test";
import { NIST_RMF_IDS, type NistMapping, parseNistMapping } from "./nist.ts";

const COMMITTED_PATH = `${import.meta.dir}/../../../governance/nist/nist-ai-rmf-1.0-mapping.json`;

/** A minimal valid mapping with all 19 categories; `statuses` patches by id. */
function makeMapping(
  statuses: Record<string, "supported" | "partial" | "deployer-owned"> = {},
): NistMapping {
  return {
    framework: "NIST AI Risk Management Framework (AI RMF 1.0)",
    publicationId: "NIST AI 100-1",
    version: "1.0",
    published: "2023-01-26",
    companionProfile: "NIST-AI-600-1",
    revisionStatus: "1.0 in force",
    retrievedAt: "2026-06-24",
    sourceUrl: "https://doi.org/10.6028/NIST.AI.100-1",
    scope: "test",
    sharedResponsibility: "deployer-owned is a boundary, not a deficiency",
    statusLegend: { supported: "s", partial: "p", "deployer-owned": "d" },
    items: NIST_RMF_IDS.map((id) => {
      const status = statuses[id] ?? "supported";
      const fn = (id.split(" ")[0] ?? "GOVERN") as NistMapping["items"][number]["function"];
      return {
        id,
        function: fn,
        title: `t-${id}`,
        status,
        mechanisms: status === "deployer-owned" ? [] : [{ name: "m", ref: "r", note: "n" }],
        note: "a boundary note",
      };
    }),
  };
}

describe("parseNistMapping — no silent omissions", () => {
  test("accepts a complete, well-formed mapping", () => {
    expect(() => parseNistMapping(makeMapping())).not.toThrow();
  });

  test("rejects a mapping missing a category", () => {
    const raw = makeMapping();
    raw.items = raw.items.filter((c) => c.id !== "MANAGE 4");
    expect(() => parseNistMapping(raw)).toThrow(/missing AI RMF categories: MANAGE 4/);
  });

  test("rejects a supported/partial category with no named mechanism", () => {
    const raw = makeMapping();
    raw.items = raw.items.map((c, i) =>
      i === 0 ? { ...c, status: "partial", mechanisms: [] } : c,
    );
    expect(() => parseNistMapping(raw)).toThrow();
  });

  test("rejects a duplicate category id", () => {
    const raw = makeMapping();
    raw.items = raw.items.map((c, i) => (i === 1 ? { ...c, id: NIST_RMF_IDS[0] } : c));
    expect(() => parseNistMapping(raw)).toThrow(/duplicate/);
  });
});

describe("committed NIST mapping", () => {
  test("is valid and classifies all 19 AI RMF categories", async () => {
    const mapping = parseNistMapping(await Bun.file(COMMITTED_PATH).json());
    expect(mapping.items.map((c) => c.id).sort()).toEqual([...NIST_RMF_IDS].sort());
    expect(mapping.items).toHaveLength(19);
  });
});
