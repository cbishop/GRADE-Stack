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
 *
 * Phase 4C (ADR 0018): the kill switch is checked first, on every request, so a
 * halted gateway resolves no provider and makes no model call on either the
 * plain forward or the router path. The refusal is logged like any other block.
 *
 * Phase 4D (ADR 0019): the human review queue is the router's third route. After
 * the output guardrails, a released result is held for a named person when a
 * review trigger fires (the request asks for review, local confidence was below
 * `reviewBelow` after frontier escalation, or a redaction the policy holds). The
 * response carries `review: { held, id, trigger, reason }`, the request line
 * names the item, and the queue writes its own `review` line. `holdMaxTurns`
 * queues an agent's max-turn failure. The gateway never approves anything.
 *
 * Phase 4E (ADR 0020): a request from an authenticated agent runs under that
 * agent's manifest. Its model allowlist and token cap replace the gateway-wide
 * ones (never widening them), its turn cap counts model calls per session, and
 * an agent whose manifest requires review (every L1 agent) has every response
 * held, whatever the request says. The record names the agent as a verified
 * caller. Without an agent the caller is the self-asserted header (unverified)
 * or `anonymous`.
 */

import { randomUUID } from "node:crypto";
import {
  createDirectProvider,
  type GatewayGenerateResponse,
  type GatewayReviewResponse,
  type GatewayRouting,
  type GatewayViolation,
  type GenerateRequest,
  type GenerateResult,
  IDENTITY_ID_PATTERN,
  isContentCaptureEnabled,
  type ModelProvider,
  type ProviderName,
  type RequestContext,
  type ReviewTrigger,
  recordRequestOutput,
  type Span,
  traceProvider,
  withRequestSpan,
} from "@grade-stack/core";
import {
  ANONYMOUS_CALLER,
  AUTONOMY_LEVEL_LABEL,
  type LoadedManifest,
  manifestPolicy,
} from "./agent-manifest.ts";
import { resolveCaptureDir, writeCapture } from "./capture.ts";
import { DecisionLog, type RequestRecord, sha256Hex } from "./decision-log.ts";
import { readHaltState, resolveHaltFilePath } from "./kill-switch.ts";
import {
  applyInputPolicy,
  applyOutputPolicy,
  checkModel,
  DEFAULT_POLICY,
  type GatewayPolicy,
  type ReviewPolicy,
} from "./policy.ts";
import {
  type HoldInput,
  holdReasons,
  newReviewId,
  ReviewQueue,
  resolveReviewPolicy,
  resolveReviewQueuePath,
} from "./review-queue.ts";
import type { ConfidenceRouter } from "./router.ts";

/**
 * The result of reaching the model — a served result (with optional routing
 * observability) or a model-allowlist violation. Both the plain-forward and the
 * router path resolve to this so the output-guardrail stage is shared.
 */
type Reached =
  | { result: GenerateResult; routing?: GatewayRouting }
  | { violation: NonNullable<ReturnType<typeof checkModel>> };

/** A review hold decided for a released result, before it is queued. */
interface Hold {
  id: string;
  trigger: ReviewTrigger;
  reason: string;
  detail?: HoldInput["detail"];
}

/** What one call decided, plus what (if anything) the model served. */
interface Outcome {
  response: GatewayGenerateResponse;
  served?: GenerateResult;
  routing?: GatewayRouting;
  hold?: Hold;
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
  /**
   * Kill-switch halt file (Phase 4C). Defaults to `RELIABILITY_HALT_FILE`, else
   * `.reliability-halt`. Checked on every request, as is `RELIABILITY_HALT=1`.
   */
  haltFile?: string;
  /**
   * The human review queue (Phase 4D). Defaults to `RELIABILITY_REVIEW_QUEUE`,
   * else `./review-queue.jsonl`, writing its lines to this service's decision log.
   */
  reviewQueue?: ReviewQueue;
}

/** Most sessions whose turn counts are kept; the oldest are forgotten first. */
const MAX_TRACKED_SESSIONS = 10_000;

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
  readonly haltFile: string;
  readonly reviewQueue: ReviewQueue;
  readonly review: ReviewPolicy;
  /** Model calls per agent session (4E turn cap); insertion-ordered for eviction. */
  private readonly turns = new Map<string, number>();

  constructor(opts: GatewayServiceOptions = {}) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.resolveProvider = opts.resolveProvider ?? ((t) => createDirectProvider(t));
    this.router = opts.router;
    this.decisionLog = opts.decisionLog ?? new DecisionLog();
    this.captureContent = opts.captureContent ?? isContentCaptureEnabled();
    this.captureDir = opts.captureDir ?? resolveCaptureDir();
    this.degraded = opts.degraded ?? envDegraded();
    this.haltFile = opts.haltFile ?? resolveHaltFilePath();
    this.reviewQueue =
      opts.reviewQueue ?? new ReviewQueue(resolveReviewQueuePath(), this.decisionLog);
    this.review = resolveReviewPolicy(this.policy.review);
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
    agent?: LoadedManifest,
  ): Promise<GatewayGenerateResponse> {
    // 4E: an authenticated agent's id is the caller id; nothing else is.
    const ctx = this.resolveContext(agent ? { ...context, callerId: agent.manifest.id } : context);
    const at = new Date().toISOString();
    const started = performance.now();
    return withRequestSpan("gateway.generate", ctx, async (span) => {
      let outcome: Outcome;
      try {
        // 0. Kill switch (4C): checked per request, before any provider is resolved.
        const halt = await readHaltState(this.haltFile);
        if (halt.halted) {
          outcome = {
            response: {
              ok: false,
              violation: { policy: "kill-switch", stage: "input", reason: halt.reason },
            },
          };
        } else {
          // 0b. The agent's turn cap (4E), before anything reaches a model.
          const turnViolation = agent ? this.countTurn(agent, ctx) : null;
          outcome = turnViolation
            ? { response: { ok: false, violation: turnViolation } }
            : await this.decide(target, request, ctx, agent);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.record(span, ctx, target, request, at, started, { error: message }, agent);
        throw err;
      }
      await this.record(span, ctx, target, request, at, started, outcome, agent);
      // 4D: the request line (naming the item) first, then the hold itself.
      if (outcome.hold && outcome.response.ok) {
        await this.reviewQueue.enqueue({
          id: outcome.hold.id,
          requestId: ctx.requestId,
          callerId: this.loggedCaller(ctx),
          trigger: outcome.hold.trigger,
          reason: outcome.hold.reason,
          outputSha256: sha256Hex(outcome.response.result.text),
          ...(outcome.hold.detail ? { detail: outcome.hold.detail } : {}),
        });
      }
      return outcome.response;
    });
  }

  /**
   * Queue an agent's max-turn failure for a named person (Phase 4D). The agent
   * reports it (over HTTP, `POST /v1/review`) because the turn bound is enforced
   * agent-side; the gateway owns the queue. Not held when the policy says not.
   */
  async holdMaxTurns(
    err: { maxTurns: number; lastIssues?: string[] },
    context: Partial<RequestContext> = {},
    agent?: LoadedManifest,
  ): Promise<GatewayReviewResponse> {
    const ctx = this.resolveContext(agent ? { ...context, callerId: agent.manifest.id } : context);
    if (!this.review.onMaxTurns) {
      return {
        held: false,
        reason:
          "the gateway policy does not hold max-turn failures (RELIABILITY_REVIEW_ON_MAX_TURNS=0)",
      };
    }
    const lastIssues = (err.lastIssues ?? []).map((i) => String(i).slice(0, 200)).slice(0, 10);
    const reason = holdReasons.maxTurns(err.maxTurns, lastIssues);
    const item = await this.reviewQueue.enqueue({
      requestId: ctx.requestId,
      callerId: this.loggedCaller(ctx),
      trigger: "max-turns",
      reason,
      outputSha256: null,
      detail: { maxTurns: err.maxTurns, lastIssues },
    });
    return { held: true, id: item.id, trigger: "max-turns", reason: item.reason };
  }

  /**
   * The caller id a record carries: the context's (an authenticated agent or a
   * self-asserted header), else `anonymous` (4E). Degraded mode drops it to
   * null, the identity-propagation regression the scorecard must catch.
   */
  private loggedCaller(ctx: RequestContext): string | null {
    if (this.degraded) return null;
    return ctx.callerId ?? ANONYMOUS_CALLER;
  }

  /**
   * Count one model call against the agent's session (4E). A manifest-bound
   * call without a session cannot be counted, so it is refused; a call past the
   * manifest's `maxTurns` is refused. Returns the violation, or null.
   */
  private countTurn(agent: LoadedManifest, ctx: RequestContext): GatewayViolation | null {
    const m = agent.manifest;
    if (!ctx.sessionId) {
      return {
        policy: "agent-turn-cap",
        stage: "input",
        reason: `agent ${m.id} sent no session id (x-session-id); its turn cap of ${m.maxTurns} counts model calls per session`,
      };
    }
    const key = `${m.id}\u0000${ctx.sessionId}`;
    const used = (this.turns.get(key) ?? 0) + 1;
    this.turns.delete(key);
    this.turns.set(key, used);
    if (this.turns.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.turns.keys().next().value;
      if (oldest !== undefined) this.turns.delete(oldest);
    }
    if (used > m.maxTurns) {
      return {
        policy: "agent-turn-cap",
        stage: "input",
        reason: `agent ${m.id} exceeded its turn cap of ${m.maxTurns} model calls in session ${ctx.sessionId} (${agent.file})`,
      };
    }
    return null;
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
    agent?: LoadedManifest,
  ): Promise<Outcome> {
    // 4E: an agent runs under its manifest on top of the gateway-wide policy,
    // and a request with no maxTokens is capped at the agent's token cap.
    const policy = agent ? manifestPolicy(this.policy, agent.manifest) : this.policy;
    const req =
      agent && request.maxTokens === undefined
        ? { ...request, maxTokens: policy.maxTokens }
        : request;

    // 1. Input guardrails — refuse before spending a token on a bad request.
    const input = applyInputPolicy(req, policy);
    if (input.action === "block") {
      return { response: { ok: false, violation: this.asAgentViolation(input.violation, agent) } };
    }

    // 2. Reach the model — either the confidence router (local-first, escalate
    //    the low-confidence tail) or a plain single-provider forward. Model
    //    allowlist is checked against every provider that could serve the call.
    const settled = this.router
      ? await this.route(req, ctx, policy)
      : await this.forward(target, req, ctx, policy);
    if ("violation" in settled) {
      return {
        response: { ok: false, violation: this.asAgentViolation(settled.violation, agent) },
      };
    }
    const { result, routing } = settled;

    // 3. Output guardrails — never return secrets; redact PII in place.
    const output = applyOutputPolicy(result.text, policy);
    if (output.action === "block") {
      return { response: { ok: false, violation: output.violation }, served: result, routing };
    }

    // 4. The third route (4D): hold the released result for a named person?
    const hold = this.holdFor(req, routing, output.redactions, agent);
    return {
      response: {
        ok: true,
        result: { ...result, text: output.text },
        redactions: output.redactions,
        ...(routing ? { routing } : {}),
        ...(hold
          ? { review: { held: true, id: hold.id, trigger: hold.trigger, reason: hold.reason } }
          : {}),
      },
      served: result,
      routing,
      ...(hold ? { hold } : {}),
    };
  }

  /**
   * Which review trigger (if any) holds this result. One item per request; when
   * several fire, the request's own flag wins, then low confidence, then a
   * redaction. Low confidence applies only after the router escalated: local
   * first, then frontier, then a person.
   */
  private holdFor(
    request: GenerateRequest,
    routing: GatewayRouting | undefined,
    redactions: string[],
    agent?: LoadedManifest,
  ): Hold | undefined {
    const p = this.review;
    // 4E: the manifest asks for review on the agent's behalf. This does not
    // depend on `onRequest`: switching off honouring the request flag must not
    // release an L1 agent's actions.
    if (agent?.manifest.reviewRequired) {
      const m = agent.manifest;
      return {
        id: newReviewId(),
        trigger: "requested",
        reason: `agent ${m.id} is ${m.autonomyLevel} (${AUTONOMY_LEVEL_LABEL[m.autonomyLevel]}): its manifest requires a named person to review every response`,
      };
    }
    if (request.requiresReview === true && p.onRequest) {
      return { id: newReviewId(), trigger: "requested", reason: holdReasons.requested() };
    }
    if (routing?.escalated && p.reviewBelow !== null && routing.confidence < p.reviewBelow) {
      return {
        id: newReviewId(),
        trigger: "low-confidence",
        reason: holdReasons.lowConfidence(routing.confidence, p.reviewBelow, routing.servedBy),
        detail: {
          confidence: routing.confidence,
          threshold: p.reviewBelow,
          servedBy: routing.servedBy,
        },
      };
    }
    if (redactions.length > 0 && p.onRedaction) {
      return {
        id: newReviewId(),
        trigger: "output-redaction",
        reason: holdReasons.redaction(redactions),
        detail: { redactions },
      };
    }
    return undefined;
  }

  /** Wrap a resolved provider so its `chat` spans carry the request identity. */
  private traced(provider: ModelProvider, ctx: RequestContext): ModelProvider {
    return traceProvider(provider, { identity: ctx, captureContent: this.captureContent });
  }

  /**
   * Name a manifest limit as the agent's (4E): a token cap or model allowlist
   * that came from the manifest is `agent-token-cap` / `agent-model-not-allowed`,
   * so the log tells a manifest violation from a gateway-wide refusal.
   */
  private asAgentViolation(v: GatewayViolation, agent?: LoadedManifest): GatewayViolation {
    if (!agent) return v;
    const m = agent.manifest;
    if (v.policy === "token-cap" && m.tokenCap <= this.policy.maxTokens) {
      const asked = /maxTokens (\d+)/.exec(v.reason)?.[1] ?? "?";
      return {
        ...v,
        policy: "agent-token-cap",
        reason: `requested maxTokens ${asked} exceeds agent ${m.id}'s token cap of ${m.tokenCap} (${agent.file})`,
      };
    }
    if (v.policy === "model-allowlist") {
      const model = /model "([^"]*)"/.exec(v.reason)?.[1] ?? "?";
      return {
        ...v,
        policy: "agent-model-not-allowed",
        reason: `model "${model}" is not in agent ${m.id}'s allowed models (${m.allowedModels.join(", ")}; ${agent.file})`,
      };
    }
    return v;
  }

  /** Plain path: resolve one credentialed provider, check its model, forward. */
  private async forward(
    target: ProviderName,
    request: GenerateRequest,
    ctx: RequestContext,
    policy: GatewayPolicy,
  ): Promise<Reached> {
    const provider = this.resolveProvider(target);
    const modelViolation = checkModel(provider.model, policy);
    if (modelViolation) return { violation: modelViolation };
    return { result: await this.traced(provider, ctx).generate(request) };
  }

  /** Router path: resolve both tiers, check both models, run the router. */
  private async route(
    request: GenerateRequest,
    ctx: RequestContext,
    policy: GatewayPolicy,
  ): Promise<Reached> {
    // biome-ignore lint/style/noNonNullAssertion: router presence is checked by the caller.
    const router = this.router!;
    const local = this.resolveProvider(router.config.local);
    const escalation = this.resolveProvider(router.config.escalateTo);
    // Both tiers are sanctioned model paths of a routing gateway, so both must
    // clear the allowlist up front — an escalation to a non-allowlisted frontier
    // model should fail predictably, not mid-request.
    const modelViolation = checkModel(local.model, policy) ?? checkModel(escalation.model, policy);
    if (modelViolation) return { violation: modelViolation };
    return router.route(request, {
      local: this.traced(local, ctx),
      escalation: this.traced(escalation, ctx),
    });
  }

  /** Why the gateway did what it did, as the record's action/stage/policy/reason. */
  private explain(
    outcome: Outcome | { error: string },
  ): Pick<RequestRecord, "action" | "stage" | "policy" | "reason"> {
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
    agent?: LoadedManifest,
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
        callerId: this.loggedCaller(ctx),
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
      callerId: this.loggedCaller(ctx),
      // 4E: verified only when the caller id came from a bearer token.
      callerVerified: agent !== undefined && !this.degraded,
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
      ...("error" in outcome || !outcome.hold ? {} : { reviewId: outcome.hold.id }),
    });
  }
}
