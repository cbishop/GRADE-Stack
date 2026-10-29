// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module reference-agent/release
 *
 * The reference agent's release manifest (Phase 4C, ADR 0018): the git state,
 * a hash of the system prompt with its schema block, the model and provider,
 * every MCP tool it can call (name plus argument-schema hash, from the schemas
 * the server registers), and a hash of the runtime policy (turn bound,
 * generation parameters, the validator's output contract). The eval runner
 * stamps it into every result and `runReferenceAgent` puts it on the root span,
 * so both name the same version for the same code.
 */

import { buildReleaseManifest, type ReleaseManifest, zodValidator } from "@grade-stack/core";
import { SUPPORT_TOOL_INPUT_SCHEMAS } from "@grade-stack/mcp-server";
import { z } from "zod";
import { resolveMaxTurns, TRIAGE_GENERATION, triageSystemPrompt } from "./config.ts";
import { TriageSchema } from "./triage-schema.ts";

export interface ReferenceReleaseOptions {
  /** The turn bound in force; resolved like the agent (env, then default). */
  maxTurns?: number;
}

/** The release manifest for the reference agent running on `provider`. */
export function referenceAgentRelease(
  provider: { name: string; model: string },
  opts: ReferenceReleaseOptions = {},
): ReleaseManifest {
  const outputSchema = zodValidator(TriageSchema).jsonSchema;
  return buildReleaseManifest({
    prompt: triageSystemPrompt(outputSchema),
    model: provider.model,
    provider: provider.name,
    tools: Object.entries(SUPPORT_TOOL_INPUT_SCHEMAS).map(([name, shape]) => ({
      name,
      argSchema: z.toJSONSchema(z.object(shape)),
    })),
    policy: {
      maxTurns: resolveMaxTurns(opts.maxTurns),
      generation: TRIAGE_GENERATION,
      outputContract: outputSchema,
    },
  });
}
