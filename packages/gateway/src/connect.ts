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
 *
 * Security finding 1: both bodies are parsed against the strict core schemas
 * before anything else runs. A mismatch (a content-block array, a `system`
 * role, an unknown key, an oversized field) is 400 with one fixed message and
 * no schema detail, and never reaches the guardrails or a model. Outside
 * development (`NODE_ENV=production`) `target: "stub"` is refused the same way
 * unless `allowStubTarget` says otherwise.
 *
 * Security finding 2 (ADR 0020, "Bind address"): the server binds `127.0.0.1`
 * unless the `hostname` option or `RELIABILITY_GATEWAY_HOST` says otherwise,
 * and the returned `url` names the address it actually bound. A non-loopback
 * bind with no agent manifests throws before anything listens: an anonymous
 * gateway reachable from the network is a proxy for its credentials.
 */

import { randomUUID } from "node:crypto";
import {
  CALLER_ID_HEADER,
  GATEWAY_GENERATE_PATH,
  GATEWAY_REVIEW_PATH,
  type GatewayGenerateBody,
  GatewayGenerateBodySchema,
  type GatewayGenerateResponse,
  GatewayReviewBodySchema,
  type GatewayReviewResponse,
  IDENTITY_ID_PATTERN,
  isLoopbackHost,
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
import { DEFAULT_POLICY, type ReviewPolicy, resolveAllowedModelsFromEnv } from "./policy.ts";
import { resolveReviewPolicyFromEnv } from "./review-queue.ts";
import { resolveRouterFromEnv } from "./router.ts";

/** Overrides the bind address when the `hostname` option is not given. */
export const GATEWAY_HOST_ENV = "RELIABILITY_GATEWAY_HOST";

/** The bind address when neither the option nor the env names one. */
export const DEFAULT_GATEWAY_HOST = "127.0.0.1";

export interface GatewayServeOptions extends GatewayServiceOptions {
  /** Port to bind; 0 (default) picks a free port — handy for tests. */
  port?: number;
  /**
   * Address to bind (security finding 2). Defaults to `RELIABILITY_GATEWAY_HOST`,
   * else `127.0.0.1`. A non-loopback address needs an agent registry with at
   * least one agent, or the gateway refuses to start.
   */
  hostname?: string;
  /**
   * The agents this gateway enforces (Phase 4E). Defaults to the registry
   * `RELIABILITY_AGENTS_DIR` configures; `null` forces v2 behaviour (no
   * manifests). A malformed manifest or token entry throws at start.
   */
  agents?: AgentRegistry | null;
  /**
   * Accept `target: "stub"` from the network. The stub returns canned text, so
   * a misconfigured client that selects it would silently get fake answers.
   * Defaults to true outside production (`NODE_ENV !== "production"`), where
   * tests and demos drive the gateway with it, and false in production.
   */
  allowStubTarget?: boolean;
}

/** The one 400 body for a request that does not match the wire schema. */
const INVALID_BODY = "Bad request: invalid request body";

function invalidBody(): Response {
  return new Response(INVALID_BODY, { status: 400 });
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
 * Refuse a bind that would expose an anonymous gateway (finding 2). Loopback
 * is always allowed; anything else needs at least one agent manifest, so every
 * request from the network must carry a bearer token (ADR 0020).
 */
function assertSafeBind(hostname: string, agents: AgentRegistry | null): void {
  if (isLoopbackHost(hostname)) return;
  if (agents && agents.manifests.length > 0) return;
  throw new Error(
    `Refusing to bind the gateway to "${hostname}" with no agent manifests: anyone who can reach that address could spend this process's provider credentials anonymously. ` +
      `Either bind loopback (omit --host / ${GATEWAY_HOST_ENV}, or use ${DEFAULT_GATEWAY_HOST}), ` +
      "or configure agents (RELIABILITY_AGENTS_DIR plus RELIABILITY_AGENT_TOKENS) so every request needs a bearer token.",
  );
}

/** The URL for a bound address; IPv6 literals go in brackets. */
function urlFor(hostname: string, port: number): string {
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
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
  // Likewise the review triggers (4D) and the model allowlist (finding 6): an
  // injected policy wins, else the env.
  const policy = opts.policy ?? {
    ...DEFAULT_POLICY,
    allowedModels: resolveAllowedModelsFromEnv(),
    review: resolveReviewPolicyFromEnv(),
  };
  // And the agents (4E): injected wins (null forces none), else RELIABILITY_AGENTS_DIR.
  const agents = opts.agents === undefined ? resolveAgentRegistryFromEnv() : opts.agents;
  const allowStubTarget = opts.allowStubTarget ?? process.env.NODE_ENV !== "production";
  // Finding 2: loopback unless told otherwise, and never public and anonymous.
  // Checked before the service or the socket exists, so a refusal leaves nothing behind.
  const hostname = opts.hostname ?? (process.env[GATEWAY_HOST_ENV] || DEFAULT_GATEWAY_HOST);
  assertSafeBind(hostname, agents);
  const service = new GatewayService({ ...opts, router, policy });

  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname,
    // Finding 8: small JSON only; over 1 MB is a fast 413 (Bun's default is 128 MB).
    maxRequestBodySize: 1_048_576,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === GATEWAY_REVIEW_PATH) {
        return reviewReport(req, service, agents);
      }
      if (req.method !== "POST" || url.pathname !== GATEWAY_GENERATE_PATH) {
        return new Response("Not found", { status: 404 });
      }

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return new Response("Bad request: expected JSON body", { status: 400 });
      }
      // Finding 1: the shape is checked, not cast. No zod detail goes back.
      const parsed = GatewayGenerateBodySchema.safeParse(raw);
      if (!parsed.success) return invalidBody();
      const body: GatewayGenerateBody = parsed.data;
      if (body.target === "stub" && !allowStubTarget) return invalidBody();

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
      } catch {
        // A provider/transport failure (e.g. missing credentials, model error),
        // or a decision-log write failure: the call fails rather than go unrecorded.
        // Finding 3: the error text names IAM principals, account ids, schema
        // internals and host paths, so it never goes back to the caller. The full
        // text lives in the decision log's `reason`; the request id finds it.
        return new Response(`Gateway upstream error (request ${ctx.requestId})`, {
          status: 502,
          headers: { [REQUEST_ID_HEADER]: ctx.requestId },
        });
      }
    },
  });

  const port = server.port ?? opts.port ?? 0;
  return {
    url: urlFor(hostname, port),
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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Bad request: expected JSON body", { status: 400 });
  }
  const parsed = GatewayReviewBodySchema.safeParse(raw);
  if (!parsed.success) return invalidBody();
  const body = parsed.data;
  const ctx = requestContext(req, body);
  if (typeof ctx === "string") return new Response(ctx, { status: 400 });
  try {
    const auth = await authenticate(req, ctx, agents, service.decisionLog, GATEWAY_REVIEW_PATH);
    if ("refused" in auth) return auth.refused;
    const res = await service.holdMaxTurns(
      { maxTurns: body.maxTurns, lastIssues: body.lastIssues ?? [] },
      ctx,
      auth.agent,
    );
    return json(res, 200, ctx.requestId);
  } catch (err) {
    // Finding 3: the error text (host paths, internals) stays server-side. A
    // review-queue failure writes no decision-log line, so the operator gets it
    // on stderr; the request id in the body lets the caller quote it.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gateway: review queue error (request ${ctx.requestId}): ${message}\n`);
    return new Response(`Gateway review queue error (request ${ctx.requestId})`, {
      status: 502,
      headers: { [REQUEST_ID_HEADER]: ctx.requestId },
    });
  }
}
