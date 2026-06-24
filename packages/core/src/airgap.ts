// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/airgap
 *
 * The **air-gap egress guard** (Phase 3D): the mechanism that turns "no cloud
 * dependency" from a claim into something enforced. When `RELIABILITY_AIRGAP=1`
 * is set, every `fetch` to a non-loopback host throws {@link EgressBlockedError}
 * — so an accidental cloud call (Bedrock, a cloud OTLP endpoint, a tool that
 * phones home) fails loudly instead of silently leaving the box, while the
 * local Ollama and the local gateway (both loopback) keep working.
 *
 * It owns the *network* seam the way `gateway/sandbox` owns the *credential*
 * seam: a pure host predicate plus a `fetch` wrapper, installed at each process
 * entry point from the env. Because the eval harness propagates `process.env`
 * down its promptfoo→bridge spawn chain, setting the env once guards every
 * process that actually makes a model call. This guard covers `fetch`-based
 * egress (Ollama provider, gateway client, OTLP HTTP exporter); the AWS SDK uses
 * a separate transport and is covered air-gapped by the Phase 2C credential
 * isolation instead (a direct Bedrock call has no credentials to authenticate
 * with). See `docs/sovereign-on-prem-variant.md`.
 */

/** Env var that arms the egress guard. */
export const AIRGAP_ENV = "RELIABILITY_AIRGAP";

/** True when the air-gap egress guard is armed via {@link AIRGAP_ENV}. */
export function isAirgapEnabled(): boolean {
  const v = process.env[AIRGAP_ENV]?.toLowerCase();
  return v === "1" || v === "true";
}

/**
 * True for hosts that never leave the machine: `localhost`, the IPv4 loopback
 * block `127.0.0.0/8`, and IPv6 `::1` (bare or bracketed). Everything else —
 * including LAN addresses — is treated as egress, because a sovereign/air-gapped
 * deployment's contract is "nothing leaves this box."
 */
export function isLoopbackHost(host: string): boolean {
  if (host.length === 0) return false;
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6 loopback, bare (`::1`) or bracketed (`[::1]`) as it appears in a URL host.
  if (h === "::1" || h === "[::1]") return true;
  // IPv4 loopback block 127.0.0.0/8.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const octets = m.slice(1, 5).map(Number);
    if (octets.every((o) => o <= 255) && octets[0] === 127) return true;
  }
  return false;
}

/** Thrown when the air-gap guard blocks a fetch to a non-loopback host. */
export class EgressBlockedError extends Error {
  readonly host: string;
  readonly url: string;
  constructor(host: string, url: string) {
    super(
      `Air-gap egress blocked: refused a network call to non-loopback host "${host}" ` +
        `(${url}). The sovereign/on-prem variant must reach nothing outside this machine ` +
        `(${AIRGAP_ENV}=1).`,
    );
    this.name = "EgressBlockedError";
    this.host = host;
    this.url = url;
  }
}

/** Best-effort extraction of the absolute URL a `fetch` call targets. */
function fetchTargetUrl(input: string | URL | Request): URL | undefined {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    const maybeUrl = (input as { url?: unknown }).url;
    return typeof maybeUrl === "string" ? new URL(maybeUrl) : undefined;
  } catch {
    // Relative or unparseable target: no host to police. The underlying fetch
    // will resolve/fail it; the guard only blocks a *determinable* remote host.
    return undefined;
  }
}

/**
 * Wrap a `fetch` implementation so calls to a non-loopback host throw
 * {@link EgressBlockedError}. Pure — does not touch globals — so it is testable
 * without mutating the runtime. {@link installEgressGuard} applies it globally.
 */
export function createGuardedFetch(
  base: typeof fetch,
  allowHost: (host: string) => boolean = isLoopbackHost,
): typeof fetch {
  const guarded = ((input: string | URL | Request, init?: RequestInit) => {
    const url = fetchTargetUrl(input);
    if (url && !allowHost(url.hostname)) {
      // Throw synchronously-as-rejection to match fetch's contract.
      return Promise.reject(new EgressBlockedError(url.hostname, url.href));
    }
    return base(input, init);
  }) as typeof fetch;
  return guarded;
}

/**
 * Install the egress guard on `globalThis.fetch` and return a restore function.
 * Every provider and client in the stack uses the global `fetch`, so one install
 * guards them all for the lifetime of the process (or until restore).
 */
export function installEgressGuard(
  allowHost: (host: string) => boolean = isLoopbackHost,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = createGuardedFetch(original, allowHost);
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Install the guard iff {@link AIRGAP_ENV} is armed; returns the restore function
 * (or `undefined` when not armed). Process entry points call this once at
 * startup so a single env var air-gaps the whole spawn chain.
 */
export function installEgressGuardFromEnv(): (() => void) | undefined {
  return isAirgapEnabled() ? installEgressGuard() : undefined;
}
