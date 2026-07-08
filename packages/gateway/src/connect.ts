// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/connect
 *
 * The HTTP transport for the gateway — a thin `Bun.serve` adapter over
 * {@link GatewayService}. It exposes the single `POST /v1/generate` endpoint the
 * {@link GatewayProvider} client calls. This process is the credentialed one;
 * the agent process never is. A guardrail block is returned as HTTP 422 with a
 * structured `{ ok: false, violation }` body so the client can surface it as a
 * `GuardrailError`, while a clean result comes back as 200.
 */

import {
  GATEWAY_GENERATE_PATH,
  type GatewayGenerateBody,
  type GatewayGenerateResponse,
} from "@grade-stack/core";
import { GatewayService, type GatewayServiceOptions } from "./gateway.ts";
import { resolveRouterFromEnv } from "./router.ts";

export interface GatewayServeOptions extends GatewayServiceOptions {
  /** Port to bind; 0 (default) picks a free port — handy for tests. */
  port?: number;
}

/** A running gateway HTTP server; call `stop()` to shut it down. */
export interface GatewayHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

function json(body: GatewayGenerateResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-grade-stack-gateway": "1" },
  });
}

/**
 * Serve the gateway over HTTP. Returns once it is listening. The service (and
 * thus the provider credentials) lives for the server's lifetime; each request
 * runs the full guardrail pipeline before any model call.
 */
export function serveGateway(opts: GatewayServeOptions = {}): GatewayHandle {
  // An explicitly-injected router wins (tests); otherwise opt in from the env
  // (`RELIABILITY_ROUTER=1`), leaving the default forward-only path untouched.
  const router = opts.router ?? resolveRouterFromEnv();
  const service = new GatewayService({ ...opts, router });

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== GATEWAY_GENERATE_PATH) {
        return new Response("Not found", { status: 404 });
      }

      let body: GatewayGenerateBody;
      try {
        body = (await req.json()) as GatewayGenerateBody;
      } catch {
        return new Response("Bad request: expected JSON body", { status: 400 });
      }
      if (!body?.target || !body?.request) {
        return new Response("Bad request: missing target or request", { status: 400 });
      }

      try {
        const response = await service.generate(body.target, body.request);
        // 422 (Unprocessable) for a guardrail block, 200 for a forwarded result.
        return json(response, response.ok ? 200 : 422);
      } catch (err) {
        // A provider/transport failure (e.g. missing credentials, model error).
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Gateway upstream error: ${message}`, { status: 502 });
      }
    },
  });

  const port = server.port ?? opts.port ?? 0;
  return {
    url: `http://localhost:${port}`,
    port,
    async stop() {
      await server.stop(true);
    },
  };
}
