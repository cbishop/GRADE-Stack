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
 *
 * Phase 4B (ADR 0017): every `generate` call runs under a root span stamped with
 * the request identity and leaves exactly one decision-log line, on every path
 * (allow, block, redact, route, upstream error). The log write is part of the
 * call: if it fails, the call fails, so no decision goes unrecorded.
 */

import { randomUUID } from "node:crypto";
import {
  createDirectProvider,
  type GatewayGenerateResponse,
  type GatewayRouting,
  type GenerateRequest,
  type GenerateResult,
  IDENTITY_ID_PATTERN,
  isContentCaptureEnabled,
  type ModelProvider,
  type ProviderName,
  type RequestContext,
  recordRequestOutput,
  type Span,
  traceProvider,
  withRequestSpan,
} from "@grade-stack/core";
import { resolveCaptureDir, writeCapture } from "./capture.ts";
import { DecisionLog, type DecisionRecord, sha256Hex } from "./decision-log.ts";
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

/** What one call decided, plus what (if anything) the model served. */
interface Outcome {
  response: GatewayGenerateResponse;
  served?: GenerateResult;
  routing?: GatewayRouting;
}

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
  /**
   * The decision log (Phase 4B). Defaults to `RELIABILITY_DECISION_LOG`, else
   * `./gateway-decisions.jsonl`. There is deliberately no way to turn it off.
   */
  decisionLog?: DecisionLog;
  /** Mirror content to the capture directory; defaults to `RELIABILITY_TRACE_CONTENT`. */
  captureContent?: boolean;
  /** Capture directory; defaults to `RELIABILITY_CAPTURE_DIR`, else `./gateway-captures`. */
  captureDir?: string;
  /**
   * Canary (defaults to `RELIABILITY_DEGRADED`): drop the caller id before it is
   * logged, simulating an identity-propagation regression. The scorecard's D
   * criteria must catch it.
   */
  degraded?: boolean;
}

function envDegraded(): boolean {
  const v = process.env.RELIABILITY_DEGRADED?.toLowerCase();
  return v === "1" || v === "true";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

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
  readonly decisionLog: DecisionLog;
  private readonly captureContent: boolean;
  private readonly captureDir: string;
  private readonly degraded: boolean;

  constructor(opts: GatewayServiceOptions = {}) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.resolveProvider = opts.resolveProvider ?? ((t) => createDirectProvider(t));
    this.router = opts.router;
    this.decisionLog = opts.decisionLog ?? new DecisionLog();
    this.captureContent = opts.captureContent ?? isContentCaptureEnabled();
    this.captureDir = opts.captureDir ?? resolveCaptureDir();
    this.degraded = opts.degraded ?? envDegraded();
  }

  /**
   * Run one request through the guardrails and record the decision. The request
   * id is generated when absent; ids that are not short and file-name safe are
   * refused before anything runs.
   */
  async generate(
    target: ProviderName,
    request: GenerateRequest,
    context: Partial<RequestContext> = {},
  ): Promise<GatewayGenerateResponse> {
    const ctx = this.resolveContext(context);
    const at = new Date().toISOString();
    const started = performance.now();
    return withRequestSpan("gateway.generate", ctx, async (span) => {
      let outcome: Outcome;
      try {
        outcome = await this.decide(target, request, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.record(span, ctx, target, request, at, started, { error: message });
        throw err;
      }
      await this.record(span, ctx, target, request, at, started, outcome);
      return outcome.response;
    });
  }

  private resolveContext(context: Partial<RequestContext>): RequestContext {
    const ctx: RequestContext = {
      requestId: context.requestId ?? randomUUID(),
      ...(context.callerId && !this.degraded ? { callerId: context.callerId } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    };
    for (const [key, value] of Object.entries(ctx)) {
      if (!IDENTITY_ID_PATTERN.test(value)) {
        throw new Error(`invalid ${key}: must match ${IDENTITY_ID_PATTERN}`);
      }
    }
    return ctx;
  }

  /** The guardrail pipeline (unchanged from 2C), returning what was served too. */
  private async decide(
    target: ProviderName,
    request: GenerateRequest,
    ctx: RequestContext,
  ): Promise<Outcome> {
    // 1. Input guardrails — refuse before spending a token on a bad request.
    const input = applyInputPolicy(request, this.policy);
    if (input.action === "block") {
      return { response: { ok: false, violation: input.violation } };
    }

    // 2. Reach the model — either the confidence router (local-first, escalate
    //    the low-confidence tail) or a plain single-provider forward. Model
    //    allowlist is checked against every provider that could serve the call.
    const settled = this.router
      ? await this.route(request, ctx)
      : await this.forward(target, request, ctx);
    if ("violation" in settled) {
      return { response: { ok: false, violation: settled.violation } };
    }
    const { result, routing } = settled;

    // 3. Output guardrails — never return secrets; redact PII in place.
    const output = applyOutputPolicy(result.text, this.policy);
    if (output.action === "block") {
      return { response: { ok: false, violation: output.violation }, served: result, routing };
    }

    return {
      response: {
        ok: true,
        result: { ...result, text: output.text },
        redactions: output.redactions,
        ...(routing ? { routing } : {}),
      },
      served: result,
      routing,
    };
  }

  /** Wrap a resolved provider so its `chat` spans carry the request identity. */
  private traced(provider: ModelProvider, ctx: RequestContext): ModelProvider {
    return traceProvider(provider, { identity: ctx, captureContent: this.captureContent });
  }

  /** Plain path: resolve one credentialed provider, check its model, forward. */
  private async forward(
    target: ProviderName,
    request: GenerateRequest,
    ctx: RequestContext,
  ): Promise<Reached> {
    const provider = this.resolveProvider(target);
    const modelViolation = checkModel(provider.model, this.policy);
    if (modelViolation) return { violation: modelViolation };
    return { result: await this.traced(provider, ctx).generate(request) };
  }

  /** Router path: resolve both tiers, check both models, run the router. */
  private async route(request: GenerateRequest, ctx: RequestContext): Promise<Reached> {
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
    return router.route(request, {
      local: this.traced(local, ctx),
      escalation: this.traced(escalation, ctx),
    });
  }

  /** Why the gateway did what it did, as the record's action/stage/policy/reason. */
  private explain(
    outcome: Outcome | { error: string },
  ): Pick<DecisionRecord, "action" | "stage" | "policy" | "reason"> {
    if ("error" in outcome) {
      const reason = `provider call failed: ${outcome.error}`.slice(0, 300);
      return { action: "error", stage: null, policy: "upstream-error", reason };
    }
    const { response, routing } = outcome;
    if (!response.ok) {
      const v = response.violation;
      return { action: "block", stage: v.stage, policy: v.policy, reason: v.reason };
    }
    if (response.redactions.length > 0) {
      const what = [...new Set(response.redactions)].join(", ");
      const reason = `redacted ${what} from the model output before returning it`;
      return { action: "redact", stage: "output", policy: "pii-redaction", reason };
    }
    if (routing && this.router) {
      const t = pct(this.router.config.threshold);
      const reason = routing.escalated
        ? `local agreement ${pct(routing.confidence)} was below the ${t} threshold; escalated to ${routing.servedBy}`
        : `local agreement ${pct(routing.confidence)} met the ${t} threshold; served locally`;
      return { action: "allow", stage: null, policy: "confidence-router", reason };
    }
    const reason = "passed every input and output guardrail";
    return { action: "allow", stage: null, policy: "guardrails", reason };
  }

  /**
   * Mirror content (when opted in) to the capture file and the request span, then
   * append exactly one decision-log line. Both content sinks take the same
   * post-redaction text, so the trace never holds what the caller did not get.
   */
  private async record(
    span: Span,
    ctx: RequestContext,
    target: ProviderName,
    request: GenerateRequest,
    at: string,
    started: number,
    outcome: Outcome | { error: string },
  ): Promise<void> {
    const served = "error" in outcome ? undefined : outcome.served;
    const routing = "error" in outcome ? undefined : outcome.routing;
    const returned =
      "error" in outcome || !outcome.response.ok ? null : outcome.response.result.text;
    if (this.captureContent) {
      if (returned !== null) recordRequestOutput(span, returned);
      await writeCapture(this.captureDir, {
        v: 1,
        requestId: ctx.requestId,
        callerId: ctx.callerId ?? null,
        at,
        target,
        request,
        output: returned,
      });
    }
    await this.decisionLog.append({
      v: 1,
      at,
      requestId: ctx.requestId,
      callerId: ctx.callerId ?? null,
      // 4B trusts the x-caller-id header; 4E authenticates it.
      callerVerified: false,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      target,
      ...this.explain(outcome),
      redactions: "error" in outcome || !outcome.response.ok ? [] : outcome.response.redactions,
      servedBy: routing?.servedBy ?? served?.provider ?? null,
      model: served?.model ?? null,
      escalated: routing?.escalated ?? false,
      confidence: routing?.confidence ?? null,
      inputSha256: sha256Hex(JSON.stringify(request)),
      outputSha256: returned === null ? null : sha256Hex(returned),
      tokens: {
        input: served?.usage.inputTokens ?? 0,
        output: served?.usage.outputTokens ?? 0,
      },
      latencyMs: Math.round((performance.now() - started) * 10) / 10,
      contentCaptured: this.captureContent,
    });
  }
}
