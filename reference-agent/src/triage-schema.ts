// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/triage-schema
 *
 * The triage output contract as a Zod schema — the single source of truth for
 * the validator. The schema (not the prompt) is what makes the agent's output
 * trustworthy: the Phase 2A validator parses against it and rejects anything
 * non-conforming, and its JSON-Schema projection is what the executor is told
 * to produce. Field order matches the deterministic stub provider so the
 * canonical serialization is byte-stable for the CI eval gate baseline.
 */

import { z } from "zod";

export const CATEGORIES = ["billing", "technical", "account", "other"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;

/**
 * The structured triage result. Every field is required and the three
 * classification fields are closed enums — that closedness is the contract the
 * validator enforces.
 */
export const TriageSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  sentiment: z.enum(SENTIMENTS),
  summary: z.string().min(1),
  draft_reply: z.string().min(1),
});

export type Triage = z.infer<typeof TriageSchema>;
