// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/providers/gateway
 *
 * The agent-side seam onto the Phase 2C LLM gateway. `GatewayProvider` is a
 * {@link ModelProvider} that holds **no** provider credentials — it forwards
 * every request over HTTP to the gateway, which alone holds Bedrock/Ollama
 * access and enforces guardrails server-side. This module owns the *client* and
 * the *wire contract* (`GatewayGenerateBody`/`GatewayGenerateResponse`); the
 * gateway package implements the server against the same contract. Keeping the
 * wire types here (not in the gateway package) is deliberate: `@grade-stack/core`
 * must never depend on the credentialed gateway package, so the agent bundle
 * cannot transitively pull in provider SDKs/credentials.
 *
 * Phase 4D (ADR 0019): a held result carries `review` (the review item id and
 * why), and `requestReview` reports a max-turn failure to the gateway's review
 * queue over `POST /v1/review`. There is no approve endpoint: approval is a
 * local, named operator action (`reliability review approve --as <name>`).
 *
 * Phase 4E (ADR 0020): the agent authenticates with a bearer token
 * (`authorization: Bearer <token>`), and the gateway derives the caller id from
 * it. Each provider carries a session id (`x-session-id`) the gateway counts
 * turns against; `withSession` opens a fresh one per agent run. A 401 carries a
 * structured `caller-auth` violation and surfaces as a `GuardrailError`.
 */

import { randomUUID } from "node:crypto";
import type { MaxTurnsError } from "../pev.ts";
import type {
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderName,
  ReviewHold,
} from "../types.ts";

/** The single endpoint the gateway exposes; the client and server share it. */
export const GATEWAY_GENERATE_PATH = "/v1/generate";

/** Where an agent reports a max-turn failure for human review (Phase 4D). */
export const GATEWAY_REVIEW_PATH = "/v1/review";

/**
 * What can put an item in the review queue (Phase 4D, ADR 0019): local
 * confidence below `reviewBelow` after frontier escalation, a max-turn failure,
 * an output redaction (when the policy says so), or the request asking for it.
 */
export const REVIEW_TRIGGERS = [
  "low-confidence",
  "max-turns",
  "output-redaction",
  "requested",
] as const;

/** One review trigger. */
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];

/** The body of `POST /v1/review`: an agent reporting it could not converge. */
export interface GatewayReviewBody {
  trigger: "max-turns";
  /** The enforced turn bound the agent hit. */
  maxTurns: number;
  /** The validator issues from the last attempt, if any. */
  lastIssues?: string[];
  context?: Partial<RequestContext>;
}

/** The gateway's answer to a review report: held with an id, or not held and why. */
export type GatewayReviewResponse = ReviewHold | { held: false; reason: string };

/** Header carrying the request id (Phase 4B); the gateway echoes it on every response. */
export const REQUEST_ID_HEADER = "x-request-id";
/**
 * Header carrying a self-asserted caller id (Phase 4B). With agent manifests
 * (4E) the caller id comes from the bearer token instead, and a header that
 * disagrees with the token is refused; without manifests it is logged as
 * unverified, as in 4B.
 */
export const CALLER_ID_HEADER = "x-caller-id";
/** Header carrying the session id the gateway counts an agent's turns against (Phase 4E). */
export const SESSION_ID_HEADER = "x-session-id";

/**
 * Allowed shape for request, caller and session ids: short, and safe as a file
 * name and inside a log line. Anything else is refused at the HTTP adapter.
 */
export const IDENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

/**
 * Who and which request a gateway call belongs to (Phase 4B, ADR 0017). The
 * request id links a decision-log line to its trace. The caller id is the
 * authenticated agent when the gateway has manifests (4E, ADR 0020), else a
 * self-asserted header logged as unverified.
 */
export interface RequestContext {
  requestId: string;
  callerId?: string;
  sessionId?: string;
}

/** The request envelope: which real provider to use, and the generation request. */
export interface GatewayGenerateBody {
  /** The provider the gateway should call on the agent's behalf. */
  target: ProviderName;
  request: GenerateRequest;
  /**
   * Optional request identity in the body. The `x-request-id` / `x-caller-id`
   * headers take precedence; the gateway generates a request id when neither
   * supplies one.
   */
  context?: Partial<RequestContext>;
}

/** A guardrail decision the gateway refused to forward or return. */
export interface GatewayViolation {
  /** The policy that fired (e.g. `prompt-injection`, `secret-exfiltration`). */
  policy: string;
  /** Human-readable reason, safe to surface (carries no secret material). */
  reason: string;
  /** Whether the block happened on the inbound request or the model's output. */
  stage: "input" | "output";
}

/**
 * Observability for a confidence-routed request (Week 3 router, ADR 0015).
 * Present only when the gateway ran the self-consistency router; absent for a
 * plain single-provider forward. Carries no model output — just the decision —
 * so cost/reliability tooling (the scorecard) can read the escalation rate.
 */
export interface GatewayRouting {
  /** Whether the low-confidence tail was escalated to the frontier provider. */
  escalated: boolean;
  /** Modal-agreement fraction of the local votes, in [0, 1] (invalid dilute). */
  confidence: number;
  /** How many local votes were drawn (N). */
  samples: number;
  /** How many of those votes parsed to a valid consensus key. */
  validSamples: number;
  /** Which real provider actually served the returned result. */
  servedBy: ProviderName;
}

/** The gateway's response: either a (possibly redacted) result, or a violation. */
export type GatewayGenerateResponse =
  | {
      ok: true;
      result: GenerateResult;
      redactions: string[];
      routing?: GatewayRouting;
      /** Present when the result is held for a named human (Phase 4D). */
      review?: ReviewHold;
    }
  | { ok: false; violation: GatewayViolation };

/**
 * Thrown by {@link GatewayProvider.generate} when the gateway blocks a request.
 * It is a *server-side* refusal surfaced to the agent — the agent cannot suppress
 * it, because enforcement happened in the gateway process, not here.
 */
export class GuardrailError extends Error {
  readonly policy: string;
  readonly stage: "input" | "output";
  constructor(violation: GatewayViolation) {
    super(
      `Guardrail "${violation.policy}" blocked the request at the ${violation.stage} stage: ${violation.reason}`,
    );
    this.name = "GuardrailError";
    this.policy = violation.policy;
    this.stage = violation.stage;
  }
}

export interface GatewayProviderOptions {
  /** Base URL of the gateway, e.g. `http://localhost:8787`. */
  url: string;
  /** The provider the gateway should target on our behalf. */
  target: ProviderName;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /**
   * Caller id sent as `x-caller-id` on every request (Phase 4B). Logged as
   * unverified; with a `token` the gateway derives the caller id from the
   * token and refuses a header that disagrees.
   */
  callerId?: string;
  /**
   * The agent's bearer token (Phase 4E), sent as `authorization: Bearer`. The
   * factory reads it from `RELIABILITY_AGENT_TOKEN`. Never logged.
   */
  token?: string;
  /** Session id the gateway counts turns against; defaults to a fresh UUID. */
  sessionId?: string;
}

/**
 * A credential-free {@link ModelProvider} that routes generation through the
 * gateway. From the agent's perspective it *is* the target provider — `name`
 * reflects the target so traces and cost accounting read unchanged — but the
 * only thing this object can do is POST to the gateway. The model id and real
 * provider name in the returned {@link GenerateResult} come back from the
 * gateway, so downstream display/cost logic stays accurate.
 */
export class GatewayProvider implements ModelProvider {
  readonly name: ProviderName;
  readonly model: string;
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly callerId?: string;
  private readonly token?: string;
  /** The session this provider's calls count against at the gateway (4E). */
  readonly sessionId: string;
  private readonly opts: GatewayProviderOptions;

  constructor(opts: GatewayProviderOptions) {
    this.opts = opts;
    this.name = opts.target;
    // Placeholder until the first result echoes the gateway's real model id.
    this.model = `gateway:${opts.target}`;
    this.url = opts.url.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.callerId = opts.callerId;
    this.token = opts.token;
    this.sessionId = opts.sessionId ?? randomUUID();
  }

  /**
   * The same gateway client on a new session (Phase 4E). The reference agent
   * opens one per run, so the gateway's per-session turn cap bounds each run.
   */
  withSession(sessionId: string): GatewayProvider {
    return new GatewayProvider({ ...this.opts, sessionId });
  }

  /** Identity headers: the bearer token, the session, and any self-asserted caller id. */
  private identityHeaders(): Record<string, string> {
    return {
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      [SESSION_ID_HEADER]: this.sessionId,
      ...(this.callerId ? { [CALLER_ID_HEADER]: this.callerId } : {}),
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body: GatewayGenerateBody = { target: this.name, request };

    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}${GATEWAY_GENERATE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.identityHeaders() },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Gateway unreachable at ${this.url} — start it with \`reliability gateway serve\` ` +
          `or set RELIABILITY_GATEWAY_URL. Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 422 carries a structured guardrail violation, and so does a 503 from a
    // halted gateway (the Phase 4C kill switch) and a 401 from caller
    // authentication (4E). Any other non-2xx, or a 503/401 without a violation
    // body (a proxy), is a real transport/server error.
    if (res.status === 503 || res.status === 401) {
      const body = (await res.json().catch(() => null)) as GatewayGenerateResponse | null;
      if (body && !body.ok && body.violation) throw new GuardrailError(body.violation);
      throw new Error(`Gateway request failed: ${res.status} ${res.statusText}`);
    }
    if (!res.ok && res.status !== 422) {
      throw new Error(`Gateway request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GatewayGenerateResponse;
    if (!data.ok) {
      throw new GuardrailError(data.violation);
    }
    return data.review ? { ...data.result, review: data.review } : data.result;
  }

  /**
   * Report a max-turn failure to the gateway's review queue (Phase 4D). The
   * gateway queues it for a named human when its policy holds max-turn failures,
   * and says so either way. Nothing here can approve anything.
   */
  async requestReview(err: MaxTurnsError): Promise<GatewayReviewResponse> {
    const body: GatewayReviewBody = {
      trigger: "max-turns",
      maxTurns: err.maxTurns,
      lastIssues: err.lastIssues,
    };
    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}${GATEWAY_REVIEW_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.identityHeaders() },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new Error(
        `Gateway unreachable at ${this.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as GatewayGenerateResponse | null;
      if (body && !body.ok && body.violation) throw new GuardrailError(body.violation);
    }
    if (!res.ok) throw new Error(`Gateway review report failed: ${res.status} ${res.statusText}`);
    return (await res.json()) as GatewayReviewResponse;
  }
}
