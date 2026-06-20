// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/sandbox
 *
 * Builds the environment for a **credential-isolated agent process**: every
 * provider credential the parent holds is removed, ambient AWS credential files
 * and instance-metadata are neutralised, and the gateway is pinned as the only
 * model path (`RELIABILITY_AGENT_SANDBOX=1` + `RELIABILITY_GATEWAY_URL`). This is
 * the mechanism behind the structural half of the Phase 2C proof — a process
 * launched with this env genuinely cannot reach a provider directly. Pure (it
 * takes the base env in) so both the `gateway demo` command and the tests build
 * the same sandbox.
 */

/** Credential-bearing env vars stripped from the isolated agent process. */
export const STRIPPED_CREDENTIAL_VARS = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "OLLAMA_HOST",
] as const;

/**
 * Derive the isolated agent env from a base env. Credential vars are dropped,
 * AWS credential resolution is dead-ended (so a direct Bedrock call fails on
 * credentials, fast and offline), and the gateway is set as the sole model path.
 */
export function isolatedAgentEnv(
  base: Record<string, string | undefined>,
  gatewayUrl: string,
): Record<string, string> {
  const stripped = new Set<string>(STRIPPED_CREDENTIAL_VARS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !stripped.has(key)) {
      env[key] = value;
    }
  }
  // Dead-end any ambient AWS credential source so a direct provider call has
  // genuinely nothing to authenticate with.
  env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
  env.AWS_CONFIG_FILE = "/dev/null";
  env.AWS_EC2_METADATA_DISABLED = "true";
  // Region is not a credential; keep one set so the SDK fails on creds, not config.
  env.AWS_REGION = "us-east-1";
  // The gateway is the only sanctioned model path.
  env.RELIABILITY_AGENT_SANDBOX = "1";
  env.RELIABILITY_GATEWAY_URL = gatewayUrl;
  // Client targets a real provider name so it routes through the gateway (stub
  // would resolve directly); the gateway decides the real backing provider.
  env.RELIABILITY_PROVIDER = "bedrock";
  return env;
}
