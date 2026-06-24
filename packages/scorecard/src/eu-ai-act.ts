// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scorecard/eu-ai-act
 *
 * Parses and validates the EU AI Act deployer readout
 * (`governance/eu-ai-act/eu-ai-act-deployer-2026.json`) and reduces it to the
 * {@link GovernanceReadiness} summary the scorecard's Governance-readiness
 * dimension is computed from (Phase 3C — the last dimension). Pure: no I/O —
 * callers read the JSON and hand the parsed object in. The parse is strict on
 * purpose: a scored obligation claiming `supported`/`partial` must name a
 * mechanism, and every obligation must carry a responsibility note — so readiness
 * is never asserted without evidence. Governance readiness rates the stack's
 * *readiness contribution*, NOT legal compliance, which is the deployer's.
 */

import { z } from "zod";

/** How well the stack readies a deployer for one obligation. */
export type StackSupport = "supported" | "partial" | "deployer-owned";

const MechanismSchema = z.object({
  name: z.string().min(1),
  ref: z.string().min(1),
  note: z.string().min(1),
});

const ObligationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    owner: z.enum(["deployer", "provider", "shared"]),
    applicability: z.enum([
      "in-force",
      "from-2026-08-02",
      "conditional-high-risk",
      "provider-only",
    ]),
    effectiveDate: z.string().min(1),
    deferralNote: z.string().min(1).optional(),
    penaltyTier: z.enum(["Tier 1", "Tier 2", "Tier 3"]),
    scored: z.boolean(),
    stackSupport: z.enum(["supported", "partial", "deployer-owned"]),
    mechanisms: z.array(MechanismSchema),
    note: z.string().min(1),
  })
  .refine((o) => !(o.scored && o.stackSupport !== "deployer-owned") || o.mechanisms.length >= 1, {
    // A scored supported/partial obligation must name a mechanism (no readiness without evidence).
    message: "scored supported/partial obligations must name at least one mechanism",
    path: ["mechanisms"],
  });

const ModuleSchema = z.object({
  framework: z.string().min(1),
  regulation: z.string().min(1),
  lens: z.string().min(1),
  enteredIntoForce: z.string().min(1),
  retrievedAt: z.string().min(1),
  sourceUrl: z.url(),
  scope: z.string().min(1),
  omnibusStatus: z.object({
    name: z.string().min(1),
    stage: z.string().min(1),
    legalEffect: z.string().min(1),
    ifAdopted: z.array(z.string().min(1)),
  }),
  penaltyTiers: z
    .array(
      z.object({ tier: z.string().min(1), cap: z.string().min(1), appliesTo: z.string().min(1) }),
    )
    .length(3),
  penaltyNote: z.string().min(1),
  statusLegend: z.record(z.string(), z.string()),
  applicabilityLegend: z.record(z.string(), z.string()),
  obligations: z.array(ObligationSchema).min(1),
  scoreWeights: z.object({
    supported: z.number(),
    partial: z.number(),
    "deployer-owned": z.number(),
  }),
});

/** One EU AI Act obligation as it bears on a deployer. */
export type EuAiActObligation = z.infer<typeof ObligationSchema>;
/** The full, validated EU AI Act deployer module. */
export type EuAiActModule = z.infer<typeof ModuleSchema>;

/**
 * Validate a raw EU AI Act deployer module. Throws on any schema violation or a
 * scored supported/partial obligation that names no mechanism. There is no fixed
 * article set (the Act is open-ended), so completeness here means structural
 * honesty per obligation rather than a closed checklist.
 */
export function parseEuAiActModule(raw: unknown): EuAiActModule {
  return ModuleSchema.parse(raw);
}

/** Rolled-up governance readiness the scorecard consumes (analogous to GuardrailCoverage). */
export interface GovernanceReadiness {
  framework: string;
  regulation: string;
  retrievedAt: string;
  sourceUrl: string;
  omnibusStage: string;
  /** Total obligations listed (scored + context). */
  total: number;
  /** Obligations that contribute to the readiness score (deployer-facing, stack-supportable). */
  scoredCount: number;
  supported: number;
  partial: number;
  deployerOwned: number;
  /** Weighted readiness in [0,1] over scored obligations: supported=1, partial=0.5, deployer-owned=0. */
  score: number;
  /** Ids of obligations in force now or from 2026-08-02 (what a deployer must plan for). */
  inForceNowIds: string[];
  /** Ids of scored obligations the stack does NOT support (deployer-owned legal duties). */
  deployerOwnedIds: string[];
}

/** Reduce a validated module to the readiness summary the scorecard rates. */
export function computeGovernanceReadiness(mod: EuAiActModule): GovernanceReadiness {
  const w = mod.scoreWeights;
  const weightFor = (s: StackSupport): number => w[s];

  const scored = mod.obligations.filter((o) => o.scored);
  const supported = scored.filter((o) => o.stackSupport === "supported").length;
  const partial = scored.filter((o) => o.stackSupport === "partial").length;
  const deployerOwned = scored.filter((o) => o.stackSupport === "deployer-owned").length;
  const weight = scored.reduce((s, o) => s + weightFor(o.stackSupport), 0);

  return {
    framework: mod.framework,
    regulation: mod.regulation,
    retrievedAt: mod.retrievedAt,
    sourceUrl: mod.sourceUrl,
    omnibusStage: mod.omnibusStatus.stage,
    total: mod.obligations.length,
    scoredCount: scored.length,
    supported,
    partial,
    deployerOwned,
    score: scored.length === 0 ? 0 : weight / scored.length,
    inForceNowIds: mod.obligations
      .filter((o) => o.applicability === "in-force" || o.applicability === "from-2026-08-02")
      .map((o) => o.id),
    deployerOwnedIds: scored.filter((o) => o.stackSupport === "deployer-owned").map((o) => o.id),
  };
}
