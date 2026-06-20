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
  type GenerateRequest,
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

export interface GatewayServiceOptions {
  /** Guardrail limits; defaults to {@link DEFAULT_POLICY}. */
  policy?: GatewayPolicy;
  /**
   * Resolve a target provider name to a credentialed provider. Defaults to
   * {@link createDirectProvider} (real Bedrock/Ollama). Injectable so tests can
   * drive the full enforcement path against the hermetic stub.
   */
  resolveProvider?: (target: ProviderName) => ModelProvider;
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

  constructor(opts: GatewayServiceOptions = {}) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.resolveProvider = opts.resolveProvider ?? ((t) => createDirectProvider(t));
  }

  async generate(target: ProviderName, request: GenerateRequest): Promise<GatewayGenerateResponse> {
    // 1. Input guardrails — refuse before spending a token on a bad request.
    const input = applyInputPolicy(request, this.policy);
    if (input.action === "block") {
      return { ok: false, violation: input.violation };
    }

    // 2. Resolve the credentialed provider and check the model allowlist.
    const provider = this.resolveProvider(target);
    const modelViolation = checkModel(provider.model, this.policy);
    if (modelViolation) {
      return { ok: false, violation: modelViolation };
    }

    // 3. Forward to the model (the gateway alone holds the credentials).
    const result = await provider.generate(request);

    // 4. Output guardrails — never return secrets; redact PII in place.
    const output = applyOutputPolicy(result.text, this.policy);
    if (output.action === "block") {
      return { ok: false, violation: output.violation };
    }

    return {
      ok: true,
      result: { ...result, text: output.text },
      redactions: output.redactions,
    };
  }
}
