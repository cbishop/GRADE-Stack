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
 *
 * Phase 4B: the adapter reads `x-request-id` and `x-caller-id` (falling back to
 * the body's `context`), generates a request id when none is supplied, refuses
 * ids that are not short and file-name safe (400), and echoes the request id on
 * every response so a caller can find its decision-log line and trace.
 *
 * Phase 4C: a request refused by the kill switch is 503 with the same structured
 * `{ ok: false, violation }` body, so the client raises a `GuardrailError`.
 */

import { randomUUID } from "node:crypto";
import {
  CALLER_ID_HEADER,
  GATEWAY_GENERATE_PATH,
  type GatewayGenerateBody,
  type GatewayGenerateResponse,
  IDENTITY_ID_PATTERN,
  REQUEST_ID_HEADER,
  type RequestContext,
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
  /** The decision log file this gateway appends to (Phase 4B). */
  decisionLogPath: string;
  /** The kill-switch halt file this gateway checks on every request (Phase 4C). */
  haltFile: string;
  stop(): Promise<void>;
}

function json(body: GatewayGenerateResponse, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-grade-stack-gateway": "1",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

/**
 * Build the request context from headers (preferred) and the body's `context`.
 * Returns an error string when a supplied id is malformed.
 */
function requestContext(req: Request, body: GatewayGenerateBody): RequestContext | string {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? body.context?.requestId;
  const callerId = req.headers.get(CALLER_ID_HEADER) ?? body.context?.callerId;
  const sessionId = body.context?.sessionId;
  for (const [name, value] of [
    [REQUEST_ID_HEADER, requestId],
    [CALLER_ID_HEADER, callerId],
    ["sessionId", sessionId],
  ] as const) {
    if (value !== undefined && !IDENTITY_ID_PATTERN.test(value)) {
      return `Bad request: ${name} must be 1-128 characters of [A-Za-z0-9._:@-]`;
    }
  }
  return {
    requestId: requestId ?? randomUUID(),
    ...(callerId ? { callerId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
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

      const ctx = requestContext(req, body);
      if (typeof ctx === "string") {
        return new Response(ctx, { status: 400 });
      }

      try {
        const response = await service.generate(body.target, body.request, ctx);
        // 200 for a forwarded result; 503 while the kill switch is pulled (4C);
        // 422 (Unprocessable) for any other guardrail block.
        const status = response.ok ? 200 : response.violation.policy === "kill-switch" ? 503 : 422;
        return json(response, status, ctx.requestId);
      } catch (err) {
        // A provider/transport failure (e.g. missing credentials, model error),
        // or a decision-log write failure: the call fails rather than go unrecorded.
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Gateway upstream error: ${message}`, {
          status: 502,
          headers: { [REQUEST_ID_HEADER]: ctx.requestId },
        });
      }
    },
  });

  const port = server.port ?? opts.port ?? 0;
  return {
    url: `http://localhost:${port}`,
    port,
    decisionLogPath: service.decisionLog.path,
    haltFile: service.haltFile,
    async stop() {
      await server.stop(true);
    },
  };
}
