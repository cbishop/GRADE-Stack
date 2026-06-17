// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/factory
 *
 * Provider resolution and construction — maps a name (explicit → env → default)
 * to a concrete ModelProvider, and owns the Phase 2C **credential-isolation**
 * seam. Two construction paths exist on purpose:
 *
 *   - {@link createProvider} is the *agent-side* factory. For real providers it
 *     returns a credential-free {@link GatewayProvider} whenever a gateway is
 *     configured, and in a credential-isolated agent process the gateway is the
 *     *only* path it will hand back — never a direct, credentialed provider.
 *   - {@link createDirectProvider} is the *gateway-side* path to the real model;
 *     it refuses to run inside a credential-isolated agent process.
 *
 * This is the mechanism, not a doc: with `RELIABILITY_AGENT_SANDBOX=1` set, the
 * agent process *cannot* obtain a credentialed provider through either factory,
 * so the gateway is structurally un-routable-around (PRD Phase 2C).
 */

import { BedrockProvider } from "./providers/bedrock.ts";
import { GatewayProvider } from "./providers/gateway.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { StubProvider } from "./providers/stub.ts";
import type { ModelProvider, ProviderName } from "./types.ts";

const DEFAULT_PROVIDER: ProviderName = "ollama";

/** Base URL of the gateway; when set, real-provider calls route through it. */
export const GATEWAY_URL_ENV = "RELIABILITY_GATEWAY_URL";
/** Marks a credential-isolated agent process: gateway is the only model path. */
export const SANDBOX_ENV = "RELIABILITY_AGENT_SANDBOX";
/** Dev escape hatch: `off` disables gateway routing (ignored when sandboxed). */
export const GATEWAY_TOGGLE_ENV = "RELIABILITY_GATEWAY";

/**
 * Resolve the provider to use, in precedence order:
 *   explicit argument (e.g. `--provider`) → RELIABILITY_PROVIDER → default.
 * Throws on an unrecognized name rather than silently falling back.
 */
export function resolveProviderName(explicit?: string): ProviderName {
  const raw = (explicit ?? process.env.RELIABILITY_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase();
  if (raw === "bedrock" || raw === "ollama" || raw === "stub") {
    return raw;
  }
  throw new Error(`Unknown provider "${raw}". Expected "bedrock", "ollama", or "stub".`);
}

/** True inside a credential-isolated agent process (no provider credentials). */
export function isAgentSandbox(): boolean {
  const v = process.env[SANDBOX_ENV]?.toLowerCase();
  return v === "1" || v === "true";
}

/** The configured gateway base URL, or undefined when none is set. */
export function gatewayUrl(explicit?: string): string | undefined {
  const v = explicit ?? process.env[GATEWAY_URL_ENV];
  return v && v.length > 0 ? v : undefined;
}

/** True when a non-sandboxed dev run has opted out of gateway routing. */
function gatewayRoutingDisabled(): boolean {
  return process.env[GATEWAY_TOGGLE_ENV]?.toLowerCase() === "off";
}

export interface CreateProviderOptions {
  /** Override the gateway URL (else `RELIABILITY_GATEWAY_URL`). */
  gatewayUrl?: string;
}

/**
 * Construct the *agent-side* provider.
 *
 * - `stub` is always the hermetic, credential-free {@link StubProvider} — it
 *   never routes through the gateway, so the CI eval gate (ADR 0003) is
 *   untouched by 2C.
 * - For `bedrock`/`ollama`: in a sandboxed agent process the gateway is the only
 *   path (a missing URL is a hard error, never a silent direct fallback); when
 *   not sandboxed, real calls route through the gateway whenever one is
 *   configured (the default from Phase 2C), with `RELIABILITY_GATEWAY=off` as a
 *   local-dev escape to the direct provider.
 */
export function createProvider(name?: string, opts: CreateProviderOptions = {}): ModelProvider {
  const resolved = resolveProviderName(name);
  if (resolved === "stub") {
    return new StubProvider();
  }

  const url = gatewayUrl(opts.gatewayUrl);

  if (isAgentSandbox()) {
    if (!url) {
      throw new Error(
        `Credential-isolated agent process (${SANDBOX_ENV}=1) requires ${GATEWAY_URL_ENV}: ` +
          "the gateway is the only model path (Phase 2C). Refusing to construct a direct " +
          `"${resolved}" provider.`,
      );
    }
    return new GatewayProvider({ url, target: resolved });
  }

  if (url && !gatewayRoutingDisabled()) {
    return new GatewayProvider({ url, target: resolved });
  }
  return resolved === "bedrock" ? new BedrockProvider() : new OllamaProvider();
}

/**
 * Construct a credentialed provider **directly** — the gateway's own path to the
 * model. This is the one place provider SDKs are instantiated with credentials.
 * It refuses to run inside a credential-isolated agent process: there, the
 * gateway is the sole sanctioned model path, so a direct construction is a bug,
 * not a fallback. The hermetic `stub` is always allowed (no credentials, no
 * network) so tests can drive the gateway without real provider access.
 */
export function createDirectProvider(name?: string): ModelProvider {
  const resolved = resolveProviderName(name);
  if (resolved === "stub") {
    return new StubProvider();
  }
  if (isAgentSandbox()) {
    throw new Error(
      `Refusing to construct a direct "${resolved}" provider inside a credential-isolated ` +
        `agent process (${SANDBOX_ENV}=1): all model access must flow through the gateway (Phase 2C).`,
    );
  }
  return resolved === "bedrock" ? new BedrockProvider() : new OllamaProvider();
}
