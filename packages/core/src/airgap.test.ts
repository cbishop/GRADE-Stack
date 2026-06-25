// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/airgap.test
 *
 * Tests the Phase 3D air-gap egress guard: the loopback host predicate, the
 * fetch wrapper that blocks non-loopback hosts (and lets loopback through), the
 * global install/restore, and the env-gated installer. Hermetic — the "base"
 * fetch is a stub, so no real network is touched.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  AIRGAP_ENV,
  createGuardedFetch,
  EgressBlockedError,
  installEgressGuard,
  installEgressGuardFromEnv,
  isAirgapEnabled,
  isLoopbackHost,
} from "./airgap.ts";

describe("isLoopbackHost", () => {
  test("treats localhost and the loopback ranges as on-box", () => {
    for (const host of [
      "localhost",
      "LocalHost",
      "api.localhost",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "[::1]",
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  test("treats remote and LAN hosts as egress", () => {
    for (const host of [
      "bedrock-runtime.us-east-1.amazonaws.com",
      "api.openai.com",
      "192.168.1.10",
      "10.0.0.5",
      "8.8.8.8",
      "",
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("createGuardedFetch", () => {
  // A base fetch that records calls and never touches the network.
  function recordingFetch() {
    const calls: string[] = [];
    const base = ((input: string | URL | Request) => {
      calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : "(req)");
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;
    return { base, calls };
  }

  test("lets loopback calls reach the base fetch", async () => {
    const { base, calls } = recordingFetch();
    const guarded = createGuardedFetch(base);
    await guarded("http://127.0.0.1:11434/api/chat");
    await guarded("http://localhost:8787/v1/generate");
    expect(calls).toEqual(["http://127.0.0.1:11434/api/chat", "http://localhost:8787/v1/generate"]);
  });

  test("blocks a non-loopback host with EgressBlockedError", async () => {
    const { base, calls } = recordingFetch();
    const guarded = createGuardedFetch(base);
    const url = "https://bedrock-runtime.us-east-1.amazonaws.com/model/x/invoke";
    await expect(guarded(url)).rejects.toBeInstanceOf(EgressBlockedError);
    // The base fetch was never reached — the call did not leave the box.
    expect(calls).toEqual([]);
  });

  test("blocks URL and Request inputs alike", async () => {
    const { base } = recordingFetch();
    const guarded = createGuardedFetch(base);
    await expect(guarded(new URL("https://example.com/"))).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(guarded(new Request("https://evil.test/exfil"))).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
});

describe("installEgressGuard", () => {
  afterEach(() => {
    delete process.env[AIRGAP_ENV];
  });

  test("guards globalThis.fetch and restores it", () => {
    const before = globalThis.fetch;
    const restore = installEgressGuard();
    expect(globalThis.fetch).not.toBe(before);
    restore();
    expect(globalThis.fetch).toBe(before);
  });

  test("the installed guard blocks remote hosts globally", async () => {
    const restore = installEgressGuard();
    try {
      await expect(fetch("https://api.openai.com/v1/chat")).rejects.toBeInstanceOf(
        EgressBlockedError,
      );
    } finally {
      restore();
    }
  });

  test("installEgressGuardFromEnv only installs when armed", () => {
    delete process.env[AIRGAP_ENV];
    expect(isAirgapEnabled()).toBe(false);
    expect(installEgressGuardFromEnv()).toBeUndefined();

    process.env[AIRGAP_ENV] = "1";
    expect(isAirgapEnabled()).toBe(true);
    const before = globalThis.fetch;
    const restore = installEgressGuardFromEnv();
    expect(restore).toBeTypeOf("function");
    expect(globalThis.fetch).not.toBe(before);
    restore?.();
    expect(globalThis.fetch).toBe(before);
  });
});
