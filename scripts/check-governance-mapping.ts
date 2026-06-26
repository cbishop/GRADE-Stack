#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-governance-mapping
 *
 * Shared engine for the governance-mapping CI checks (OWASP 3A, NIST 3B, EU AI
 * Act 3C). The three checks were near-identical copies — load + parse the JSON,
 * cross-check the human README, print a summary — which had drifted (NIST even
 * re-implemented validation by hand). This collapses them onto one parameterized
 * runner (ADR 0014) so the "no silent governance omissions / no machine-human
 * drift" mechanism is defined once and each check is a thin spec.
 *
 * "Mechanisms, not prose": each caller passes its Zod parser and the facts/ids
 * its README must carry; this runner enforces them and fails the build on any
 * violation. It owns only this orchestration; it never rewrites a mapping.
 */

/** One governance mapping's check specification. */
export interface GovernanceCheckSpec<T> {
  /** Short label for messages, e.g. "OWASP". */
  label: string;
  jsonPath: string;
  readmePath: string;
  /** Validate the raw JSON; throw with a readable message on any violation. */
  parse: (raw: unknown) => T;
  /** Tokens (ids / credibility-critical facts) the README must contain. */
  requiredReadmeTokens: readonly string[];
  /** Optional extra README assertion; return an error message or null. */
  extraReadmeCheck?: (readme: string) => string | null;
  /** Build the success-line tail from the parsed mapping. */
  summary: (parsed: T) => string;
}

/** Run one governance-mapping check; exit non-zero (and never return) on failure. */
export async function checkGovernanceMapping<T>(spec: GovernanceCheckSpec<T>): Promise<void> {
  const fail = (message: string): never => {
    console.error(`✖ ${spec.label} check failed — ${message}`);
    console.error('\nSee docs/PLAN-Grade-Stack-v2.md → "Enforcement-mechanism register".');
    process.exit(1);
  };

  let parsed: T;
  try {
    parsed = spec.parse(await Bun.file(spec.jsonPath).json());
  } catch (err) {
    return fail(`${spec.jsonPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Cross-check: the human-readable README must carry every required token, so the
  // prose can't quietly omit (or contradict) what the machine-readable JSON says.
  const readme = await Bun.file(spec.readmePath).text();
  const missing = spec.requiredReadmeTokens.filter((t) => !readme.includes(t));
  if (missing.length > 0) {
    return fail(`${spec.readmePath} is missing required facts/ids: ${missing.join(", ")}`);
  }

  const extra = spec.extraReadmeCheck?.(readme);
  if (extra) {
    return fail(`${spec.readmePath}: ${extra}`);
  }

  console.log(`✓ ${spec.label} check passed — ${spec.summary(parsed)}`);
}
