// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/review-queue
 *
 * The human review queue (Phase 4D, ADR 0019): the router's third route. When a
 * review trigger fires (local confidence below `reviewBelow` after frontier
 * escalation, a max-turn failure, a configured output redaction, or a request
 * that asks for review) the gateway appends a `queued` event here and flags the
 * response as held. A named person then appends an `approved` or `rejected`
 * event with `reliability review approve|reject --as <name>`.
 *
 * The store is an append-only JSONL file of events (`RELIABILITY_REVIEW_QUEUE`,
 * default `./review-queue.jsonl`), each with a strict Zod schema. There is no
 * state file: an item's status is derived from its events every time, and a
 * stream that decides an item twice, or decides one that was never queued,
 * fails loudly on read. Every event also writes a `review` line to the decision
 * log, written first so an unlogged decision never lands.
 *
 * No code path approves without a named reviewer: approve and reject refuse a
 * missing or empty actor, an automated identity (`gateway`, `system`, ...) and
 * the caller that made the request. The gateway itself only ever enqueues.
 */

import { randomUUID } from "node:crypto";
import { appendFile, open, readFile, rm, stat } from "node:fs/promises";
import { IDENTITY_ID_PATTERN, REVIEW_TRIGGERS, type ReviewTrigger } from "@grade-stack/core";
import { z } from "zod";
import { DecisionLog } from "./decision-log.ts";
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from "./policy.ts";

/** Env naming the review queue file. */
export const REVIEW_QUEUE_ENV = "RELIABILITY_REVIEW_QUEUE";
/** Default review queue path, relative to the working directory. */
export const DEFAULT_REVIEW_QUEUE_PATH = "./review-queue.jsonl";
/** Env setting `reviewBelow` (a number in 0..1, or `off`). */
export const REVIEW_BELOW_ENV = "RELIABILITY_REVIEW_BELOW";
export const REVIEW_ON_MAX_TURNS_ENV = "RELIABILITY_REVIEW_ON_MAX_TURNS";
export const REVIEW_ON_REDACTION_ENV = "RELIABILITY_REVIEW_ON_REDACTION";
export const REVIEW_ON_REQUEST_ENV = "RELIABILITY_REVIEW_ON_REQUEST";

/** Identities that are software, not people: none of them may approve or reject. */
export const AUTOMATED_ACTORS = [
  "gateway",
  "system",
  "auto",
  "automatic",
  "automation",
  "bot",
  "agent",
  "reliability",
  "anonymous",
] as const;

const Id = z.string().regex(IDENTITY_ID_PATTERN);
const ReviewId = z.string().regex(/^rv-[0-9a-f]{12}$/);
const Text = z.string().min(1).max(500);

/** An item held for a person. `detail` carries the numbers behind the reason. */
export const QueuedEventSchema = z.strictObject({
  v: z.literal(1),
  event: z.literal("queued"),
  id: ReviewId,
  at: z.iso.datetime(),
  requestId: Id,
  callerId: Id.nullable(),
  trigger: z.enum(REVIEW_TRIGGERS),
  reason: Text,
  /** SHA-256 of the held output as returned; null when there was no output (max turns). */
  outputSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  detail: z
    .strictObject({
      confidence: z.number().min(0).max(1).optional(),
      threshold: z.number().min(0).max(1).optional(),
      servedBy: z.enum(["bedrock", "ollama", "stub"]).optional(),
      model: z.string().optional(),
      maxTurns: z.number().int().min(0).optional(),
      lastIssues: z.array(z.string()).optional(),
      redactions: z.array(z.string()).optional(),
    })
    .optional(),
});

/** A named person released the item. */
export const ApprovedEventSchema = z.strictObject({
  v: z.literal(1),
  event: z.literal("approved"),
  id: ReviewId,
  at: z.iso.datetime(),
  by: Id,
  note: Text.optional(),
});

/** A named person refused the item, with a reason. */
export const RejectedEventSchema = z.strictObject({
  v: z.literal(1),
  event: z.literal("rejected"),
  id: ReviewId,
  at: z.iso.datetime(),
  by: Id,
  reason: Text,
});

/** Any review-queue event. */
export const ReviewEventSchema = z.discriminatedUnion("event", [
  QueuedEventSchema,
  ApprovedEventSchema,
  RejectedEventSchema,
]);

export type QueuedEvent = z.infer<typeof QueuedEventSchema>;
export type ApprovedEvent = z.infer<typeof ApprovedEventSchema>;
export type RejectedEvent = z.infer<typeof RejectedEventSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

/** An item's state, derived from its events. */
export interface ReviewItem {
  id: string;
  status: "pending" | "approved" | "rejected";
  trigger: ReviewTrigger;
  reason: string;
  requestId: string;
  callerId: string | null;
  queuedAt: string;
  outputSha256: string | null;
  detail?: QueuedEvent["detail"];
  resolution:
    | null
    | { event: "approved"; by: string; at: string; note?: string }
    | { event: "rejected"; by: string; at: string; reason: string };
}

/** Thrown for a malformed line, an impossible stream, or a refused decision. Never swallowed. */
export class ReviewQueueError extends Error {
  override name = "ReviewQueueError";
}

/** The queue path: `RELIABILITY_REVIEW_QUEUE`, else the default. */
export function resolveReviewQueuePath(env: Record<string, string | undefined> = process.env) {
  const v = env[REVIEW_QUEUE_ENV];
  return v && v.length > 0 ? v : DEFAULT_REVIEW_QUEUE_PATH;
}

function envFlag(env: Record<string, string | undefined>, name: string, fallback: boolean) {
  const v = env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  throw new ReviewQueueError(`${name}="${env[name]}" must be 1/true/on or 0/false/off`);
}

/** Fill a partial review policy with the defaults; refuses a `reviewBelow` outside 0..1. */
export function resolveReviewPolicy(partial: Partial<ReviewPolicy> = {}): ReviewPolicy {
  const p = { ...DEFAULT_REVIEW_POLICY, ...partial };
  if (p.reviewBelow !== null && !(p.reviewBelow >= 0 && p.reviewBelow <= 1)) {
    throw new ReviewQueueError(`reviewBelow must be between 0 and 1, got ${p.reviewBelow}`);
  }
  return p;
}

/** The review triggers from `RELIABILITY_REVIEW_*`; a bad value throws rather than defaulting. */
export function resolveReviewPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): ReviewPolicy {
  const raw = env[REVIEW_BELOW_ENV]?.trim().toLowerCase();
  let reviewBelow: number | null = DEFAULT_REVIEW_POLICY.reviewBelow;
  if (raw !== undefined && raw !== "" && raw !== "off") {
    reviewBelow = Number(raw);
    if (Number.isNaN(reviewBelow)) {
      throw new ReviewQueueError(`${REVIEW_BELOW_ENV}="${raw}" is not a number in 0..1`);
    }
  }
  const d = DEFAULT_REVIEW_POLICY;
  return resolveReviewPolicy({
    reviewBelow,
    onMaxTurns: envFlag(env, REVIEW_ON_MAX_TURNS_ENV, d.onMaxTurns),
    onRedaction: envFlag(env, REVIEW_ON_REDACTION_ENV, d.onRedaction),
    onRequest: envFlag(env, REVIEW_ON_REQUEST_ENV, d.onRequest),
  });
}

/** The triggers a policy switches on, in the canonical order. */
export function configuredTriggers(p: ReviewPolicy): ReviewTrigger[] {
  const on: Record<ReviewTrigger, boolean> = {
    "low-confidence": p.reviewBelow !== null,
    "max-turns": p.onMaxTurns,
    "output-redaction": p.onRedaction,
    requested: p.onRequest,
  };
  return REVIEW_TRIGGERS.filter((t) => on[t]);
}

/** True when `actor` is software (or the requesting caller), never a person who may decide. */
export function isAutomatedActor(actor: string, callerId: string | null): boolean {
  const a = actor.trim().toLowerCase();
  if ((AUTOMATED_ACTORS as readonly string[]).includes(a)) return true;
  return callerId !== null && a === callerId.toLowerCase();
}

// ── Reasons, one sentence each ──────────────────────────────────────────────

export const holdReasons = {
  lowConfidence: (confidence: number, threshold: number, servedBy: string) =>
    `confidence ${confidence.toFixed(2)} below the review threshold ${threshold.toFixed(2)} after frontier escalation to ${servedBy}`,
  maxTurns: (maxTurns: number, issues: string[] = []) =>
    `the agent did not converge within its turn bound of ${maxTurns}${
      issues.length > 0 ? `; last validation issues: ${issues.join("; ")}` : ""
    }`.slice(0, 500),
  redaction: (what: string[]) =>
    `the output had ${[...new Set(what)].join(", ")} redacted; the policy holds redacted outputs for review`,
  requested: () => "the request asked for human review (requiresReview)",
};

// ── Reading and deriving ────────────────────────────────────────────────────

function schemaFor(json: unknown) {
  const event =
    typeof json === "object" && json !== null ? (json as { event?: unknown }).event : undefined;
  if (event === "queued") return QueuedEventSchema;
  if (event === "approved") return ApprovedEventSchema;
  if (event === "rejected") return RejectedEventSchema;
  return ReviewEventSchema;
}

/** Parse queue JSONL into events; any bad line throws with `source:line`. */
export function parseReviewQueue(text: string, source: string): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new ReviewQueueError(`${source}:${i + 1}: not valid JSON`);
    }
    const parsed = schemaFor(json).safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ReviewQueueError(
        `${source}:${i + 1}: ${issue?.path.join(".") || "event"}: ${issue?.message ?? "invalid"}`,
      );
    }
    events.push(parsed.data);
  }
  return events;
}

/** Read and validate a queue file. A missing file throws (the caller named it). */
export async function readReviewQueue(path: string): Promise<ReviewEvent[]> {
  return parseReviewQueue(await readFile(path, "utf8"), path);
}

/**
 * Derive every item's state from the event stream, in queue order. A decision
 * for an unknown item, a second decision, a decision dated before its hold, or
 * an id queued twice is an impossible stream and throws.
 */
export function deriveReviewItems(events: ReviewEvent[], source: string): ReviewItem[] {
  const items = new Map<string, ReviewItem>();
  for (const e of events) {
    const existing = items.get(e.id);
    if (e.event === "queued") {
      if (existing) throw new ReviewQueueError(`${source}: review item ${e.id} is queued twice`);
      items.set(e.id, {
        id: e.id,
        status: "pending",
        trigger: e.trigger,
        reason: e.reason,
        requestId: e.requestId,
        callerId: e.callerId,
        queuedAt: e.at,
        outputSha256: e.outputSha256,
        ...(e.detail ? { detail: e.detail } : {}),
        resolution: null,
      });
      continue;
    }
    if (!existing) throw new ReviewQueueError(`${source}: no review item ${e.id} to ${e.event}`);
    assertPending(existing, source);
    if (Date.parse(e.at) < Date.parse(existing.queuedAt)) {
      throw new ReviewQueueError(`${source}: review item ${e.id} is ${e.event} before it was held`);
    }
    existing.status = e.event;
    existing.resolution =
      e.event === "approved"
        ? { event: "approved", by: e.by, at: e.at, ...(e.note ? { note: e.note } : {}) }
        : { event: "rejected", by: e.by, at: e.at, reason: e.reason };
  }
  return [...items.values()];
}

function assertPending(item: ReviewItem, source: string): void {
  if (item.resolution === null) return;
  throw new ReviewQueueError(
    `${source}: review item ${item.id} is already ${item.status} by ${item.resolution.by} at ${item.resolution.at}; an item is decided once`,
  );
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** What the gateway knows when it holds a result. */
export interface HoldInput {
  /** Pre-assigned id, so the request line can name the item; generated when absent. */
  id?: string;
  requestId: string;
  callerId: string | null;
  trigger: ReviewTrigger;
  reason: string;
  outputSha256: string | null;
  detail?: QueuedEvent["detail"];
}

/** A reviewer's decision: who, and for a rejection why. */
export interface ApproveInput {
  as: string;
  note?: string;
}
export interface RejectInput {
  as: string;
  reason: string;
}

/** A fresh review item id, `rv-` plus 12 hex characters. */
export function newReviewId(): string {
  return `rv-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** One short exclusive lock per decision, so two reviewers cannot both decide an item. */
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // A lock older than 30 s belongs to a reviewer process that died.
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > 30_000) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new ReviewQueueError(`${lock}: another reviewer holds the queue; try again`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * The append-only queue. `enqueue` is the gateway's only verb; `approve` and
 * `reject` are a named person's. Each writes its decision-log line first, then
 * its event, so an unlogged event never lands.
 */
export class ReviewQueue {
  readonly decisionLog: DecisionLog;

  constructor(
    readonly path: string = resolveReviewQueuePath(),
    decisionLog?: DecisionLog,
  ) {
    this.decisionLog = decisionLog ?? new DecisionLog();
  }

  /** Every event, validated; an absent file is an empty queue. */
  async events(): Promise<ReviewEvent[]> {
    try {
      return await readReviewQueue(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /** Every item, its state derived from the events. */
  async items(): Promise<ReviewItem[]> {
    return deriveReviewItems(await this.events(), this.path);
  }

  /** One item, or null. */
  async get(id: string): Promise<ReviewItem | null> {
    return (await this.items()).find((i) => i.id === id) ?? null;
  }

  /** Hold a result for a person. */
  async enqueue(input: HoldInput): Promise<ReviewItem> {
    const event = QueuedEventSchema.parse({
      v: 1,
      event: "queued",
      id: input.id ?? newReviewId(),
      at: new Date().toISOString(),
      requestId: input.requestId,
      callerId: input.callerId,
      trigger: input.trigger,
      reason: input.reason.slice(0, 500),
      outputSha256: input.outputSha256,
      ...(input.detail ? { detail: input.detail } : {}),
    });
    await this.decisionLog.append({
      v: 1,
      kind: "review",
      at: event.at,
      requestId: event.requestId,
      reviewId: event.id,
      event: "queued",
      actor: "gateway",
      callerId: event.callerId,
      trigger: event.trigger,
      policy: "human-review",
      reason: event.reason,
    });
    await this.append(event);
    return deriveReviewItems([event], this.path)[0] as ReviewItem;
  }

  /** A named person releases a pending item. */
  approve(id: string, input: ApproveInput): Promise<ReviewItem> {
    return this.decide(id, input.as, (by, at) =>
      ApprovedEventSchema.parse({
        v: 1,
        event: "approved",
        id,
        at,
        by,
        ...(input.note ? { note: input.note } : {}),
      }),
    );
  }

  /** A named person refuses a pending item, saying why. */
  reject(id: string, input: RejectInput): Promise<ReviewItem> {
    if (typeof input.reason !== "string" || input.reason.trim() === "") {
      return Promise.reject(new ReviewQueueError("a rejection needs a reason (--reason <text>)"));
    }
    return this.decide(id, input.as, (by, at) =>
      RejectedEventSchema.parse({ v: 1, event: "rejected", id, at, by, reason: input.reason }),
    );
  }

  private async decide(
    id: string,
    as: unknown,
    build: (by: string, at: string) => ApprovedEvent | RejectedEvent,
  ): Promise<ReviewItem> {
    if (typeof as !== "string" || as.trim() === "") {
      throw new ReviewQueueError(
        "a decision needs a named reviewer (--as <name>); nothing is approved automatically",
      );
    }
    if (!IDENTITY_ID_PATTERN.test(as)) {
      throw new ReviewQueueError("reviewer name must be 1-128 characters of [A-Za-z0-9._:@-]");
    }
    return withLock(this.path, async () => {
      const events = await this.events();
      const item = deriveReviewItems(events, this.path).find((i) => i.id === id);
      if (!item) throw new ReviewQueueError(`${this.path}: no review item ${id}`);
      assertPending(item, this.path);
      if ((AUTOMATED_ACTORS as readonly string[]).includes(as.toLowerCase())) {
        throw new ReviewQueueError(`"${as}" is an automated identity; a named person must decide`);
      }
      if (isAutomatedActor(as, item.callerId)) {
        throw new ReviewQueueError(
          `"${as}" is the requesting caller; an agent cannot decide on its own output`,
        );
      }
      const event = build(as, new Date().toISOString());
      await this.decisionLog.append({
        v: 1,
        kind: "review",
        at: event.at,
        requestId: item.requestId,
        reviewId: id,
        event: event.event,
        actor: as,
        callerId: item.callerId,
        trigger: item.trigger,
        policy: "human-review",
        reason:
          event.event === "rejected" ? event.reason : (event.note ?? "approved with no note given"),
      });
      await this.append(event);
      return deriveReviewItems([...events, event], this.path).find(
        (i) => i.id === id,
      ) as ReviewItem;
    });
  }

  private async append(event: ReviewEvent): Promise<void> {
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { flag: "a", encoding: "utf8" });
  }
}
