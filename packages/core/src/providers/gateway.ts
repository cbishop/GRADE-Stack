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
 */

import type { GenerateRequest, GenerateResult, ModelProvider, ProviderName } from "../types.ts";

/** The single endpoint the gateway exposes; the client and server share it. */
export const GATEWAY_GENERATE_PATH = "/v1/generate";

/** Header carrying the request id (Phase 4B); the gateway echoes it on every response. */
export const REQUEST_ID_HEADER = "x-request-id";
/** Header carrying the caller id (Phase 4B: trusted and logged as unverified; 4E authenticates it). */
export const CALLER_ID_HEADER = "x-caller-id";

/**
 * Allowed shape for request, caller and session ids: short, and safe as a file
 * name and inside a log line. Anything else is refused at the HTTP adapter.
 */
export const IDENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

/**
 * Who and which request a gateway call belongs to (Phase 4B, ADR 0017). The
 * request id links a decision-log line to its trace. In 4B the caller id is a
 * self-asserted header, logged as unverified; Phase 4E authenticates it.
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
  | { ok: true; result: GenerateResult; redactions: string[]; routing?: GatewayRouting }
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
   * Caller id sent as `x-caller-id` on every request (Phase 4B), so the
   * gateway's decision log can attribute the call. Unverified until 4E.
   */
  callerId?: string;
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

  constructor(opts: GatewayProviderOptions) {
    this.name = opts.target;
    // Placeholder until the first result echoes the gateway's real model id.
    this.model = `gateway:${opts.target}`;
    this.url = opts.url.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.callerId = opts.callerId;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body: GatewayGenerateBody = { target: this.name, request };

    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}${GATEWAY_GENERATE_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.callerId ? { [CALLER_ID_HEADER]: this.callerId } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Gateway unreachable at ${this.url} — start it with \`reliability gateway serve\` ` +
          `or set RELIABILITY_GATEWAY_URL. Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 422 carries a structured guardrail violation; other non-2xx is a real
    // transport/server error. Both still parse a JSON body where possible.
    if (!res.ok && res.status !== 422) {
      throw new Error(`Gateway request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GatewayGenerateResponse;
    if (!data.ok) {
      throw new GuardrailError(data.violation);
    }
    return data.result;
  }
}
