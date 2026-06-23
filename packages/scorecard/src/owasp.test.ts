// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/owasp.test
 *
 * Tests for the OWASP mapping parser and coverage reducer — the "no silent
 * omissions" enforcement (completeness, mechanism-named, residual-gap-stated),
 * the weighted-score reduction, and that the committed governance mapping is
 * itself valid and covers all ten ASI threats.
 */

import { describe, expect, test } from "bun:test";
import {
  computeGuardrailCoverage,
  OWASP_ASI_IDS,
  type OwaspMapping,
  parseOwaspMapping,
} from "./owasp.ts";

const COMMITTED_PATH = `${import.meta.dir}/../../../governance/owasp/owasp-agentic-top10-2026.json`;

/** A minimal valid mapping with all ten threats; `overrides` patches items by id. */
function makeMapping(statuses: Record<string, "covered" | "partial" | "gap">): OwaspMapping {
  return {
    taxonomy: "OWASP Top 10 for Agentic Applications",
    version: "2026",
    identifierScheme: "ASI01:2026 – ASI10:2026",
    publishedAt: "2025-12-09",
    retrievedAt: "2026-06-23",
    sourceUrl: "https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/",
    scope: "test",
    statusLegend: { covered: "c", partial: "p", gap: "g" },
    scoreWeights: { covered: 1, partial: 0.5, gap: 0 },
    items: OWASP_ASI_IDS.map((id) => {
      const status = statuses[id] ?? "covered";
      return {
        id,
        title: `t-${id}`,
        summary: `s-${id}`,
        status,
        mechanisms: status === "gap" ? [] : [{ name: "m", ref: "r", note: "n" }],
        residualGap: status === "covered" ? undefined : "a stated gap",
      };
    }),
  };
}

describe("parseOwaspMapping — no silent omissions", () => {
  test("accepts a complete, well-formed mapping", () => {
    const raw = makeMapping({});
    expect(() => parseOwaspMapping(raw)).not.toThrow();
  });

  test("rejects a mapping missing a threat", () => {
    const raw = makeMapping({});
    raw.items = raw.items.filter((it) => it.id !== "ASI07:2026");
    expect(() => parseOwaspMapping(raw)).toThrow(/missing items: ASI07:2026/);
  });

  test("rejects a duplicate threat id", () => {
    const raw = makeMapping({});
    // Make item[1] a duplicate of ASI01 (item[0]).
    raw.items = raw.items.map((it, i) => (i === 1 ? { ...it, id: OWASP_ASI_IDS[0] } : it));
    expect(() => parseOwaspMapping(raw)).toThrow(/duplicate/);
  });

  test("rejects a covered/partial item with no named mechanism", () => {
    const raw = makeMapping({});
    raw.items = raw.items.map((it, i) =>
      i === 0 ? { ...it, status: "partial" as const, mechanisms: [], residualGap: "x" } : it,
    );
    expect(() => parseOwaspMapping(raw)).toThrow();
  });

  test("rejects a partial/gap item with no residual gap stated", () => {
    const raw = makeMapping({});
    raw.items = raw.items.map((it, i) =>
      i === 0 ? { ...it, status: "gap" as const, mechanisms: [], residualGap: undefined } : it,
    );
    expect(() => parseOwaspMapping(raw)).toThrow();
  });

  test("rejects an unknown identifier scheme value", () => {
    const raw = makeMapping({});
    raw.items = raw.items.map((it, i) =>
      i === 0 ? { ...it, id: "T1" as unknown as (typeof OWASP_ASI_IDS)[number] } : it,
    );
    expect(() => parseOwaspMapping(raw)).toThrow();
  });
});

describe("computeGuardrailCoverage — weighted reduction", () => {
  test("all covered → score 1.0, no gaps", () => {
    const cov = computeGuardrailCoverage(parseOwaspMapping(makeMapping({})));
    expect(cov.score).toBe(1);
    expect(cov.covered).toBe(10);
    expect(cov.gaps).toBe(0);
    expect(cov.gapIds).toEqual([]);
  });

  test("partial counts half, gap counts zero", () => {
    const cov = computeGuardrailCoverage(
      parseOwaspMapping(
        makeMapping({
          "ASI01:2026": "partial",
          "ASI02:2026": "partial",
          "ASI03:2026": "gap",
        }),
      ),
    );
    // 7 covered + 2 partial(0.5) + 1 gap(0) = 8 / 10
    expect(cov.score).toBeCloseTo(0.8, 5);
    expect(cov.covered).toBe(7);
    expect(cov.partial).toBe(2);
    expect(cov.gaps).toBe(1);
    expect(cov.gapIds).toEqual(["ASI03:2026"]);
  });
});

describe("committed governance mapping", () => {
  test("is valid and classifies all ten ASI threats", async () => {
    const raw = await Bun.file(COMMITTED_PATH).json();
    const mapping = parseOwaspMapping(raw);
    expect(mapping.version).toBe("2026");
    expect(mapping.items.map((it) => it.id).sort()).toEqual([...OWASP_ASI_IDS].sort());

    const cov = computeGuardrailCoverage(mapping);
    expect(cov.total).toBe(10);
    expect(cov.covered + cov.partial + cov.gaps).toBe(10);
    // Every gap is explicitly flagged (never silently assumed safe).
    expect(cov.gaps).toBe(cov.gapIds.length);
  });
});
