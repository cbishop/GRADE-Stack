// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/gateway
 *
 * The gateway service: the one place that holds provider credentials and runs
 * the guardrail engine around every model call. Given a request it applies the
 * input policy, forwards to the (credentialed) provider only if allowed, then
 * applies the output policy to what comes back. It is transport-agnostic — the
 * HTTP server in `./connect` is a thin adapter over this — so the exact same
 * enforcement path is exercised by unit tests and by the live server.
 */

import {
  createDirectProvider,
  type GatewayGenerateResponse,
  type GatewayRouting,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  type ProviderName,
} from "@grade-stack/core";
import {
  applyInputPolicy,
  applyOutputPolicy,
  checkModel,
  DEFAULT_POLICY,
  type GatewayPolicy,
} from "./policy.ts";
import type { ConfidenceRouter } from "./router.ts";

/**
 * The result of reaching the model — a served result (with optional routing
 * observability) or a model-allowlist violation. Both the plain-forward and the
 * router path resolve to this so the output-guardrail stage is shared.
 */
type Reached =
  | { result: GenerateResult; routing?: GatewayRouting }
  | { violation: NonNullable<ReturnType<typeof checkModel>> };

export interface GatewayServiceOptions {
  /** Guardrail limits; defaults to {@link DEFAULT_POLICY}. */
  policy?: GatewayPolicy;
  /**
   * Resolve a target provider name to a credentialed provider. Defaults to
   * {@link createDirectProvider} (real Bedrock/Ollama). Injectable so tests can
   * drive the full enforcement path against the hermetic stub.
   */
  resolveProvider?: (target: ProviderName) => ModelProvider;
  /**
   * Optional confidence router (Week 3, ADR 0015). When present the gateway
   * runs the local-self-consistency → escalate-to-frontier policy for every
   * request instead of forwarding to a single `target`; the guardrails still
   * wrap whatever the router returns. Absent, the gateway is a plain forwarder.
   */
  router?: ConfidenceRouter;
}

/**
 * The credential-holding policy-enforcement core. `generate` always runs the
 * input policy → provider → output policy pipeline; there is no path through it
 * that reaches the model without the guardrails, which is what makes the
 * enforcement server-side rather than advisory.
 */
export class GatewayService {
  private readonly policy: GatewayPolicy;
  private readonly resolveProvider: (target: ProviderName) => ModelProvider;
  private readonly router?: ConfidenceRouter;

  constructor(opts: GatewayServiceOptions = {}) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.resolveProvider = opts.resolveProvider ?? ((t) => createDirectProvider(t));
    this.router = opts.router;
  }

  async generate(target: ProviderName, request: GenerateRequest): Promise<GatewayGenerateResponse> {
    // 1. Input guardrails — refuse before spending a token on a bad request.
    const input = applyInputPolicy(request, this.policy);
    if (input.action === "block") {
      return { ok: false, violation: input.violation };
    }

    // 2. Reach the model — either the confidence router (local-first, escalate
    //    the low-confidence tail) or a plain single-provider forward. Model
    //    allowlist is checked against every provider that could serve the call.
    const settled = this.router ? await this.route(request) : await this.forward(target, request);
    if ("violation" in settled) {
      return { ok: false, violation: settled.violation };
    }

    // 3. Output guardrails — never return secrets; redact PII in place.
    const output = applyOutputPolicy(settled.result.text, this.policy);
    if (output.action === "block") {
      return { ok: false, violation: output.violation };
    }

    const routing = settled.routing;
    return {
      ok: true,
      result: { ...settled.result, text: output.text },
      redactions: output.redactions,
      ...(routing ? { routing } : {}),
    };
  }

  /** Plain path: resolve one credentialed provider, check its model, forward. */
  private async forward(target: ProviderName, request: GenerateRequest): Promise<Reached> {
    const provider = this.resolveProvider(target);
    const modelViolation = checkModel(provider.model, this.policy);
    if (modelViolation) return { violation: modelViolation };
    return { result: await provider.generate(request) };
  }

  /** Router path: resolve both tiers, check both models, run the router. */
  private async route(request: GenerateRequest): Promise<Reached> {
    // biome-ignore lint/style/noNonNullAssertion: router presence is checked by the caller.
    const router = this.router!;
    const local = this.resolveProvider(router.config.local);
    const escalation = this.resolveProvider(router.config.escalateTo);
    // Both tiers are sanctioned model paths of a routing gateway, so both must
    // clear the allowlist up front — an escalation to a non-allowlisted frontier
    // model should fail predictably, not mid-request.
    const modelViolation =
      checkModel(local.model, this.policy) ?? checkModel(escalation.model, this.policy);
    if (modelViolation) return { violation: modelViolation };
    return router.route(request, { local, escalation });
  }
}
