// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/nist
 *
 * Parses and validates the NIST AI RMF 1.0 → stack mapping
 * (`governance/nist/nist-ai-rmf-1.0-mapping.json`). Pure: no I/O — callers read
 * the JSON and hand the parsed object in. The parse is strict on purpose and is
 * the "no silent governance omissions" mechanism for NIST (Phase 3B): all 19 AI
 * RMF categories must be present exactly once, each classified
 * supported/partial/deployer-owned, every supported/partial category must name a
 * mechanism, and every category must state its responsibility-boundary note.
 *
 * NIST is a standalone procurement artifact, not a scorecard dimension, so this
 * module validates structure and completeness but computes no rating. It shares
 * the `supported/partial/deployer-owned` status model with the EU AI Act module
 * (ADR 0010); giving NIST a real Zod schema (ADR 0014) brings it to the same
 * validation rigor as the OWASP and EU AI Act mappings, replacing the previously
 * hand-rolled checks in `scripts/check-nist-coverage.ts`.
 */

import { z } from "zod";

/** The four AI RMF 1.0 functions. */
export const NIST_FUNCTIONS = ["GOVERN", "MAP", "MEASURE", "MANAGE"] as const;

/** The 19 AI RMF 1.0 categories (GOVERN 1–6, MAP 1–5, MEASURE 1–4, MANAGE 1–4). */
export const NIST_RMF_IDS = [
  "GOVERN 1",
  "GOVERN 2",
  "GOVERN 3",
  "GOVERN 4",
  "GOVERN 5",
  "GOVERN 6",
  "MAP 1",
  "MAP 2",
  "MAP 3",
  "MAP 4",
  "MAP 5",
  "MEASURE 1",
  "MEASURE 2",
  "MEASURE 3",
  "MEASURE 4",
  "MANAGE 1",
  "MANAGE 2",
  "MANAGE 3",
  "MANAGE 4",
] as const;

/** How the stack bears on one AI RMF category (shared with the EU AI Act module). */
export type NistSupport = "supported" | "partial" | "deployer-owned";

const MechanismSchema = z.object({
  name: z.string().min(1),
  ref: z.string().min(1),
  note: z.string().min(1),
});

const CategorySchema = z
  .object({
    id: z.enum(NIST_RMF_IDS),
    function: z.enum(NIST_FUNCTIONS),
    title: z.string().min(1),
    status: z.enum(["supported", "partial", "deployer-owned"]),
    mechanisms: z.array(MechanismSchema),
    // Every category states its responsibility boundary — never left implicit.
    note: z.string().min(1),
  })
  .refine((c) => c.status === "deployer-owned" || c.mechanisms.length >= 1, {
    // No coverage claimed without evidence: supported/partial must name a mechanism.
    message: "supported/partial categories must name at least one mechanism",
    path: ["mechanisms"],
  });

const MappingSchema = z.object({
  framework: z.string().min(1),
  publicationId: z.string().min(1),
  version: z.string().min(1),
  published: z.string().min(1),
  companionProfile: z.string().min(1),
  revisionStatus: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceUrl: z.url(),
  scope: z.string().min(1),
  sharedResponsibility: z.string().min(1),
  statusLegend: z.record(z.string(), z.string()),
  items: z.array(CategorySchema),
});

/** One AI RMF category as it bears on the stack. */
export type NistCategory = z.infer<typeof CategorySchema>;
/** The full, validated NIST AI RMF → stack mapping. */
export type NistMapping = z.infer<typeof MappingSchema>;

/**
 * Validate a raw NIST mapping and enforce completeness: exactly the 19 AI RMF
 * categories, each exactly once. Throws with a readable message on any schema
 * violation, missing category, or duplicate — this is what makes "every AI RMF
 * category is classified" a mechanism rather than a promise.
 */
export function parseNistMapping(raw: unknown): NistMapping {
  const mapping = MappingSchema.parse(raw);

  const ids = mapping.items.map((c) => c.id);
  const seen = new Set(ids);
  if (seen.size !== ids.length) {
    throw new Error("NIST mapping has duplicate category ids");
  }
  const missing = NIST_RMF_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(
      `NIST mapping is missing AI RMF categories: ${missing.join(", ")} (no silent omissions)`,
    );
  }
  return mapping;
}
