// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/factory.test
 *
 * Tests the Phase 2C credential-isolation seam in the factory: the hermetic stub
 * is always direct (CI gate untouched), real providers route through the gateway
 * when one is configured, a credential-isolated agent process can *only* get a
 * gateway-backed provider (never a direct one), and the gateway-side
 * `createDirectProvider` refuses to run inside that sandbox.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDirectProvider,
  createProvider,
  GATEWAY_TOGGLE_ENV,
  GATEWAY_URL_ENV,
  SANDBOX_ENV,
} from "./factory.ts";
import { BedrockProvider } from "./providers/bedrock.ts";
import { GatewayProvider } from "./providers/gateway.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { StubProvider } from "./providers/stub.ts";

const TOUCHED = [SANDBOX_ENV, GATEWAY_URL_ENV, GATEWAY_TOGGLE_ENV] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("createProvider — stub is always hermetic/direct", () => {
  test("stub is direct even with a gateway URL and sandbox set", () => {
    process.env[GATEWAY_URL_ENV] = "http://localhost:9999";
    process.env[SANDBOX_ENV] = "1";
    expect(createProvider("stub")).toBeInstanceOf(StubProvider);
    expect(createDirectProvider("stub")).toBeInstanceOf(StubProvider);
  });
});

describe("createProvider — gateway routing (not sandboxed)", () => {
  test("no gateway configured ⇒ direct provider", () => {
    expect(createProvider("ollama")).toBeInstanceOf(OllamaProvider);
    expect(createProvider("bedrock")).toBeInstanceOf(BedrockProvider);
  });

  test("gateway URL set ⇒ routes through the gateway", () => {
    process.env[GATEWAY_URL_ENV] = "http://localhost:8787";
    expect(createProvider("bedrock")).toBeInstanceOf(GatewayProvider);
    expect(createProvider("ollama")).toBeInstanceOf(GatewayProvider);
  });

  test("RELIABILITY_GATEWAY=off is a dev escape back to the direct provider", () => {
    process.env[GATEWAY_URL_ENV] = "http://localhost:8787";
    process.env[GATEWAY_TOGGLE_ENV] = "off";
    expect(createProvider("bedrock")).toBeInstanceOf(BedrockProvider);
  });
});

describe("createProvider — credential-isolated agent process", () => {
  test("with a gateway URL, real providers are gateway-backed", () => {
    process.env[SANDBOX_ENV] = "1";
    process.env[GATEWAY_URL_ENV] = "http://localhost:8787";
    expect(createProvider("bedrock")).toBeInstanceOf(GatewayProvider);
  });

  test("without a gateway URL, refuses to build any real provider (no silent direct fallback)", () => {
    process.env[SANDBOX_ENV] = "1";
    expect(() => createProvider("bedrock")).toThrow(/only model path/i);
    expect(() => createProvider("ollama")).toThrow(/only model path/i);
  });
});

describe("createDirectProvider — gateway-side only", () => {
  test("refuses to construct a credentialed provider inside the sandbox", () => {
    process.env[SANDBOX_ENV] = "1";
    expect(() => createDirectProvider("bedrock")).toThrow(/credential-isolated/i);
    expect(() => createDirectProvider("ollama")).toThrow(/credential-isolated/i);
  });

  test("constructs the real provider outside the sandbox", () => {
    expect(createDirectProvider("bedrock")).toBeInstanceOf(BedrockProvider);
    expect(createDirectProvider("ollama")).toBeInstanceOf(OllamaProvider);
  });
});
