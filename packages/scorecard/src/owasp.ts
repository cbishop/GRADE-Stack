// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/owasp
 *
 * Parses and validates the OWASP Agentic Top 10 → stack mapping
 * (`governance/owasp/owasp-agentic-top10-2026.json`) and reduces it to the
 * {@link GuardrailCoverage} summary the scorecard's Guardrail-coverage dimension
 * is computed from (Phase 3A; scoring revised post-mortem — see ADR 0013). Pure:
 * no I/O — callers read the JSON and hand the parsed object in. The parse is
 * strict on purpose: it is the "no silent omissions" mechanism — every threat
 * must be classified, every covered/partial item must name a mechanism, and every
 * partial/gap must state its residual gap.
 *
 * Each threat also carries a `scored` flag (the model shared with the EU AI Act
 * module's `scored`, ADR 0014). A threat is `scored: false` only when it targets
 * a capability this single-agent, stateless architecture does not implement
 * (e.g. a long-term memory store, an agent-to-agent channel) — such a threat is
 * **out of architectural scope, not a deficiency**, so it is reported but excluded
 * from the weighted score's denominator. The `residualGap` of an unscored item
 * must state why the capability is absent (enforced below), so "out of scope"
 * can never be a silent escape hatch for an inconvenient gap.
 */

import { z } from "zod";

/** The ten ASI identifiers of the OWASP Top 10 for Agentic Applications 2026. */
export const OWASP_ASI_IDS = [
  "ASI01:2026",
  "ASI02:2026",
  "ASI03:2026",
  "ASI04:2026",
  "ASI05:2026",
  "ASI06:2026",
  "ASI07:2026",
  "ASI08:2026",
  "ASI09:2026",
  "ASI10:2026",
] as const;

/** Coverage status for one threat. See the JSON's `statusLegend`. */
export type CoverageStatus = "covered" | "partial" | "gap";

const MechanismSchema = z.object({
  name: z.string().min(1),
  ref: z.string().min(1),
  note: z.string().min(1),
});

const ItemSchema = z
  .object({
    id: z.enum(OWASP_ASI_IDS),
    title: z.string().min(1),
    summary: z.string().min(1),
    status: z.enum(["covered", "partial", "gap"]),
    /**
     * Whether this threat counts toward the weighted coverage score. `false` only
     * for threats that are out of architectural scope (the capability they target
     * does not exist in this single-agent, stateless stack). Defaults to `true`.
     */
    scored: z.boolean().default(true),
    mechanisms: z.array(MechanismSchema),
    residualGap: z.string().min(1).optional(),
  })
  .refine((it) => it.status === "gap" || it.mechanisms.length >= 1, {
    // No silent omissions: a "covered" or "partial" claim must name a mechanism.
    message: "covered/partial items must name at least one mechanism",
    path: ["mechanisms"],
  })
  .refine((it) => it.status === "covered" || (it.residualGap?.length ?? 0) > 0, {
    // A partial or a gap is only honest if it states what is left uncovered.
    message: "partial/gap items must state a residualGap",
    path: ["residualGap"],
  })
  .refine((it) => it.scored || (it.residualGap?.length ?? 0) > 0, {
    // "Out of scope" is not a free pass: an unscored threat must state, on the
    // record, why the capability it targets is architecturally absent.
    message: "unscored (out-of-scope) items must state why in residualGap",
    path: ["residualGap"],
  });

const MappingSchema = z.object({
  taxonomy: z.string().min(1),
  version: z.string().min(1),
  identifierScheme: z.string().min(1),
  publishedAt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceUrl: z.url(),
  scope: z.string().min(1),
  statusLegend: z.record(z.string(), z.string()),
  scoreWeights: z.object({
    covered: z.number(),
    partial: z.number(),
    gap: z.number(),
  }),
  items: z.array(ItemSchema),
});

/** A single threat's mapping entry. */
export type OwaspItem = z.infer<typeof ItemSchema>;
/** The full, validated OWASP → stack mapping. */
export type OwaspMapping = z.infer<typeof MappingSchema>;

/**
 * Validate a raw mapping object and enforce completeness: exactly the ten ASI
 * identifiers, each exactly once. Throws with a readable message on any schema
 * violation, missing threat, or duplicate — this is what makes "every OWASP item
 * is covered or explicitly flagged" a mechanism rather than a promise.
 */
export function parseOwaspMapping(raw: unknown): OwaspMapping {
  const mapping = MappingSchema.parse(raw);

  const ids = mapping.items.map((it) => it.id);
  const seen = new Set(ids);
  if (seen.size !== ids.length) {
    throw new Error("OWASP mapping has duplicate item ids");
  }
  const missing = OWASP_ASI_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`OWASP mapping is missing items: ${missing.join(", ")} (no silent omissions)`);
  }
  return mapping;
}

/** Rolled-up guardrail coverage the scorecard consumes (analogous to TraceCoverage). */
export interface GuardrailCoverage {
  taxonomy: string;
  version: string;
  publishedAt: string;
  sourceUrl: string;
  /** Total threats in the taxonomy (10). */
  total: number;
  /**
   * Threats that apply to this architecture and count toward the score (the
   * score's denominator). `total - scoredCount` threats are out of scope.
   */
  scoredCount: number;
  /** Covered/partial/gap counts — over scored (applicable) threats only. */
  covered: number;
  partial: number;
  gaps: number;
  /** Out-of-scope (unscored) threats — reported, never counted as deficiencies. */
  outOfScope: number;
  /** Weighted coverage in [0,1] over scored threats: covered=1, partial=0.5, gap=0. */
  score: number;
  /** Ids flagged as gaps (scored threats only), for the evidence trail. */
  gapIds: string[];
  /** Ids only partially covered (scored threats only), for the evidence trail. */
  partialIds: string[];
  /** Ids out of architectural scope, for the evidence trail (not deficiencies). */
  outOfScopeIds: string[];
}

/**
 * Reduce a validated mapping to the coverage summary the scorecard rates. The
 * weighted score is taken over **scored (applicable)** threats only — out-of-scope
 * threats are reported via {@link GuardrailCoverage.outOfScopeIds} but never drag
 * the denominator, so a threat the architecture cannot face is not mislabelled a
 * gap to close (post-mortem fix; ADR 0013).
 */
export function computeGuardrailCoverage(mapping: OwaspMapping): GuardrailCoverage {
  const w = mapping.scoreWeights;
  const weightFor = (s: CoverageStatus): number =>
    s === "covered" ? w.covered : s === "partial" ? w.partial : w.gap;

  const scored = mapping.items.filter((it) => it.scored);
  const outOfScopeItems = mapping.items.filter((it) => !it.scored);
  const covered = scored.filter((it) => it.status === "covered").length;
  const partial = scored.filter((it) => it.status === "partial").length;
  const gaps = scored.filter((it) => it.status === "gap").length;
  const weight = scored.reduce((s, it) => s + weightFor(it.status), 0);

  return {
    taxonomy: mapping.taxonomy,
    version: mapping.version,
    publishedAt: mapping.publishedAt,
    sourceUrl: mapping.sourceUrl,
    total: mapping.items.length,
    scoredCount: scored.length,
    covered,
    partial,
    gaps,
    outOfScope: outOfScopeItems.length,
    score: scored.length === 0 ? 0 : weight / scored.length,
    gapIds: scored.filter((it) => it.status === "gap").map((it) => it.id),
    partialIds: scored.filter((it) => it.status === "partial").map((it) => it.id),
    outOfScopeIds: outOfScopeItems.map((it) => it.id),
  };
}
