// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { BedrockProvider } from "./providers/bedrock.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { StubProvider } from "./providers/stub.ts";
import type { ModelProvider, ProviderName } from "./types.ts";

const DEFAULT_PROVIDER: ProviderName = "ollama";

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

/** Construct the selected provider. */
export function createProvider(name?: string): ModelProvider {
  const resolved = resolveProviderName(name);
  switch (resolved) {
    case "bedrock":
      return new BedrockProvider();
    case "ollama":
      return new OllamaProvider();
    case "stub":
      return new StubProvider();
  }
}
