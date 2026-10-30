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
 *
 * Phase 4D: `POST /v1/review` takes an agent's max-turn failure and queues it
 * for a named person; a held generate response carries `review`. The review
 * triggers come from `RELIABILITY_REVIEW_*` unless a policy is injected. There
 * is deliberately no endpoint that approves or rejects: that is a local, named
 * operator action (`reliability review approve|reject --as <name>`).
 *
 * Phase 4E (ADR 0020): with agent manifests (`RELIABILITY_AGENTS_DIR`, or an
 * injected registry) every request on both endpoints must carry a bearer token
 * for a known agent. The token decides the caller id; an `x-caller-id` (header
 * or body) that disagrees is refused rather than trusted. A refusal is 401 with
 * a structured `caller-auth` violation and one `auth` decision-log line, which
 * never holds the token. With no manifests nothing changes from v2: no token is
 * needed and the caller is the self-asserted header (unverified) or `anonymous`.
 */

import { randomUUID } from "node:crypto";
import {
  CALLER_ID_HEADER,
  GATEWAY_GENERATE_PATH,
  GATEWAY_REVIEW_PATH,
  type GatewayGenerateBody,
  type GatewayGenerateResponse,
  type GatewayReviewBody,
  type GatewayReviewResponse,
  IDENTITY_ID_PATTERN,
  REQUEST_ID_HEADER,
  type RequestContext,
  SESSION_ID_HEADER,
} from "@grade-stack/core";
import {
  type AgentRegistry,
  type LoadedManifest,
  resolveAgentRegistryFromEnv,
} from "./agent-manifest.ts";
import type { DecisionLog } from "./decision-log.ts";
import { GatewayService, type GatewayServiceOptions } from "./gateway.ts";
import { DEFAULT_POLICY, type ReviewPolicy } from "./policy.ts";
import { resolveReviewPolicyFromEnv } from "./review-queue.ts";
import { resolveRouterFromEnv } from "./router.ts";

export interface GatewayServeOptions extends GatewayServiceOptions {
  /** Port to bind; 0 (default) picks a free port — handy for tests. */
  port?: number;
  /**
   * The agents this gateway enforces (Phase 4E). Defaults to the registry
   * `RELIABILITY_AGENTS_DIR` configures; `null` forces v2 behaviour (no
   * manifests). A malformed manifest or token entry throws at start.
   */
  agents?: AgentRegistry | null;
}

/** A running gateway HTTP server; call `stop()` to shut it down. */
export interface GatewayHandle {
  url: string;
  port: number;
  /** The decision log file this gateway appends to (Phase 4B). */
  decisionLogPath: string;
  /** The kill-switch halt file this gateway checks on every request (Phase 4C). */
  haltFile: string;
  /** The review queue this gateway holds results in (Phase 4D). */
  reviewQueuePath: string;
  /** The review triggers this gateway applies (Phase 4D). */
  review: ReviewPolicy;
  /** The agents it enforces, or null when it runs without manifests (Phase 4E). */
  agents: AgentRegistry | null;
  stop(): Promise<void>;
}

function json(
  body: GatewayGenerateResponse | GatewayReviewResponse,
  status: number,
  requestId: string,
): Response {
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
function requestContext(
  req: Request,
  body: Pick<GatewayGenerateBody, "context">,
): RequestContext | string {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? body.context?.requestId;
  const callerId = req.headers.get(CALLER_ID_HEADER) ?? body.context?.callerId;
  const sessionId = req.headers.get(SESSION_ID_HEADER) ?? body.context?.sessionId;
  for (const [name, value] of [
    [REQUEST_ID_HEADER, requestId],
    [CALLER_ID_HEADER, callerId],
    [SESSION_ID_HEADER, sessionId],
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

/** The authenticated agent for a request, or the 401 to send. */
type Authenticated = { agent?: LoadedManifest } | { refused: Response };

/**
 * Authenticate one request against the registry (4E). With no registry every
 * request passes as in v2. Otherwise the bearer token must name a known agent,
 * and a claimed caller id must agree with it; a refusal writes one `auth` line.
 */
async function authenticate(
  req: Request,
  ctx: RequestContext,
  agents: AgentRegistry | null,
  log: DecisionLog,
  endpoint: string,
): Promise<Authenticated> {
  if (!agents) return {};
  const auth = agents.authenticate(req.headers.get("authorization"));
  let reason: string | null = null;
  if (!auth.ok) {
    reason = auth.reason;
  } else if (ctx.callerId !== undefined && ctx.callerId !== auth.agent.manifest.id) {
    reason = `x-caller-id "${ctx.callerId}" disagrees with the agent the bearer token belongs to; the token decides who is calling`;
  }
  if (auth.ok && reason === null) return { agent: auth.agent };
  const violation = { policy: "caller-auth", stage: "input" as const, reason: reason ?? "refused" };
  await log.append({
    v: 1,
    kind: "auth",
    at: new Date().toISOString(),
    requestId: ctx.requestId,
    chokepoint: "gateway",
    endpoint,
    action: "refuse",
    status: 401,
    policy: "caller-auth",
    reason: violation.reason,
    claimedCallerId: ctx.callerId ?? null,
  });
  const res = json({ ok: false, violation }, 401, ctx.requestId);
  res.headers.set("www-authenticate", 'Bearer realm="grade-stack-gateway"');
  return { refused: res };
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
  // Likewise the review triggers (4D): an injected policy wins, else the env.
  const policy = opts.policy ?? { ...DEFAULT_POLICY, review: resolveReviewPolicyFromEnv() };
  // And the agents (4E): injected wins (null forces none), else RELIABILITY_AGENTS_DIR.
  const agents = opts.agents === undefined ? resolveAgentRegistryFromEnv() : opts.agents;
  const service = new GatewayService({ ...opts, router, policy });

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === GATEWAY_REVIEW_PATH) {
        return reviewReport(req, service, agents);
      }
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
        const auth = await authenticate(
          req,
          ctx,
          agents,
          service.decisionLog,
          GATEWAY_GENERATE_PATH,
        );
        if ("refused" in auth) return auth.refused;
        const response = await service.generate(body.target, body.request, ctx, auth.agent);
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
    reviewQueuePath: service.reviewQueue.path,
    review: service.review,
    agents,
    async stop() {
      await server.stop(true);
    },
  };
}

/**
 * `POST /v1/review`: an agent reports it could not converge within its turn
 * bound. The only trigger accepted here is `max-turns`; the others are decided
 * by the gateway itself on `/v1/generate`.
 */
async function reviewReport(
  req: Request,
  service: GatewayService,
  agents: AgentRegistry | null,
): Promise<Response> {
  let body: GatewayReviewBody;
  try {
    body = (await req.json()) as GatewayReviewBody;
  } catch {
    return new Response("Bad request: expected JSON body", { status: 400 });
  }
  if (body?.trigger !== "max-turns" || !Number.isInteger(body.maxTurns) || body.maxTurns < 0) {
    return new Response('Bad request: expected { trigger: "max-turns", maxTurns }', {
      status: 400,
    });
  }
  const ctx = requestContext(req, body);
  if (typeof ctx === "string") return new Response(ctx, { status: 400 });
  try {
    const auth = await authenticate(req, ctx, agents, service.decisionLog, GATEWAY_REVIEW_PATH);
    if ("refused" in auth) return auth.refused;
    const lastIssues = Array.isArray(body.lastIssues) ? body.lastIssues.map(String) : [];
    const res = await service.holdMaxTurns(
      { maxTurns: body.maxTurns, lastIssues },
      ctx,
      auth.agent,
    );
    return json(res, 200, ctx.requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Gateway review queue error: ${message}`, {
      status: 502,
      headers: { [REQUEST_ID_HEADER]: ctx.requestId },
    });
  }
}
