// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/agent-boundary.test
 *
 * The bite test for Phase 4E (ADR 0020), the gateway chokepoint. Two agents
 * with different manifests sit behind one live gateway:
 *
 *   - `triage` (L1: act with approval) may use the stub model, four turns per
 *     session and 800 tokens per request; every response it gets is held for a
 *     named person without it asking;
 *   - `helpdesk` (L0: suggest only) may use only the frontier test model, one
 *     turn per session and 200 tokens.
 *
 * Agent A's bearer token cannot use agent B's model or exceed A's own turn or
 * token cap; an unknown or missing token gets 401 and a decision-log line that
 * never holds the token; the authenticated caller id replaces the 4B trusted
 * header (an `x-caller-id` that disagrees with the token is refused with 401);
 * an authenticated record is marked verified; the 4D self-approval check now
 * matches the agent; and with no manifests the gateway behaves as in v2, the
 * caller logged as `anonymous`.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GatewayProvider,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  type ProviderName,
  StubProvider,
} from "@grade-stack/core";
import { loadAgentRegistry } from "./agent-manifest.ts";
import { serveGateway } from "./connect.ts";
import {
  type AuthRecord,
  DecisionLog,
  isAuthRecord,
  isRequestRecord,
  isReviewRecord,
  type RequestRecord,
  readDecisionLog,
} from "./decision-log.ts";
import { describeDecision } from "./explain.ts";
import { ReviewQueue, ReviewQueueError } from "./review-queue.ts";

const TRIAGE_TOKEN = "tok-triage-0123456789abcdef";
const HELPDESK_TOKEN = "tok-helpdesk-0123456789abcdef";

const MANIFESTS = [
  {
    id: "triage",
    owner: "support-lead@example.com",
    autonomyLevel: "L1",
    allowedTools: ["lookup_account", "search_help_articles"],
    allowedModels: ["stub-deterministic"],
    maxTurns: 4,
    tokenCap: 800,
    reviewRequired: true,
  },
  {
    id: "helpdesk",
    owner: "kb-team@example.com",
    autonomyLevel: "L0",
    allowedTools: [],
    allowedModels: ["frontier-test-model"],
    maxTurns: 1,
    tokenCap: 200,
    reviewRequired: false,
  },
];

const EMAIL: GenerateRequest = {
  system: "You are a customer-support triage assistant.",
  messages: [{ role: "user", content: "I was charged twice for invoice 8812, please refund." }],
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "grade-stack-4e-"));
}

/** The frontier stand-in: a provider whose model only `helpdesk` may use. */
function frontier(name: ProviderName = "bedrock"): ModelProvider {
  return {
    name,
    model: "frontier-test-model",
    generate(_req: GenerateRequest): Promise<GenerateResult> {
      return Promise.resolve({
        text: "Suggested article: kb-billing-duplicate.",
        usage: { inputTokens: 5, outputTokens: 5 },
        provider: name,
        model: "frontier-test-model",
      });
    },
  };
}

/** A gateway with both manifests, the stub as `stub` and the frontier stand-in as `bedrock`. */
function twoAgentGateway() {
  const dir = tmp();
  const agentsDir = join(dir, "agents");
  mkdirSync(agentsDir);
  for (const m of MANIFESTS) writeFileSync(join(agentsDir, `${m.id}.json`), JSON.stringify(m));
  const agents = loadAgentRegistry(agentsDir, {
    RELIABILITY_AGENT_TOKENS: `triage:${TRIAGE_TOKEN},helpdesk:${HELPDESK_TOKEN}`,
  });
  const logPath = join(dir, "decisions.jsonl");
  const log = new DecisionLog(logPath);
  const queuePath = join(dir, "review-queue.jsonl");
  const handle = serveGateway({
    agents,
    decisionLog: log,
    reviewQueue: new ReviewQueue(queuePath, log),
    haltFile: join(dir, "no-halt"),
    resolveProvider: (t) => (t === "stub" ? new StubProvider() : frontier(t)),
  });
  return { handle, logPath, queuePath, log };
}

interface Sent {
  status: number;
  body: {
    ok: boolean;
    violation?: { policy: string; reason: string };
    review?: { held: boolean; trigger: string; id: string };
  };
}

async function send(
  url: string,
  opts: {
    token?: string;
    target?: ProviderName;
    session?: string;
    headers?: Record<string, string>;
    request?: GenerateRequest;
  } = {},
): Promise<Sent> {
  const res = await fetch(`${url}/v1/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.session ? { "x-session-id": opts.session } : {}),
      ...opts.headers,
    },
    body: JSON.stringify({ target: opts.target ?? "stub", request: opts.request ?? EMAIL }),
  });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

describe("caller authentication at the gateway (4E)", () => {
  test("an unknown token gets 401 and one decision-log line that never holds the token", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      const res = await send(handle.url, {
        token: "tok-nobody-0123456789abcdef",
        session: "s-1",
        headers: { "x-request-id": "req-unknown" },
      });
      expect(res.status).toBe(401);
      expect(res.body.violation?.policy).toBe("caller-auth");
    } finally {
      await handle.stop();
    }
    const records = await readDecisionLog(logPath);
    expect(records.length).toBe(1);
    const line = records[0] as AuthRecord;
    expect(isAuthRecord(line)).toBe(true);
    expect(line).toMatchObject({
      kind: "auth",
      requestId: "req-unknown",
      chokepoint: "gateway",
      status: 401,
      policy: "caller-auth",
    });
    expect(line.reason).toContain("unknown bearer token");
    expect(readFileSync(logPath, "utf8")).not.toContain("tok-nobody");
    expect(describeDecision(line)).toContain("refused at the gateway with 401");
  });

  test("a request with no token is refused with 401 and logged", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      expect((await send(handle.url, { session: "s-1" })).status).toBe(401);
    } finally {
      await handle.stop();
    }
    const [line] = await readDecisionLog(logPath);
    expect(line && isAuthRecord(line) && line.reason).toBe("no bearer token");
  });

  test("the authenticated caller id replaces the trusted header and is marked verified", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      const ok = await send(handle.url, {
        token: HELPDESK_TOKEN,
        target: "bedrock",
        session: "h-1",
        headers: { "x-request-id": "req-verified" },
      });
      expect(ok.status).toBe(200);
      // A header that agrees with the token is fine.
      expect(
        (
          await send(handle.url, {
            token: HELPDESK_TOKEN,
            target: "bedrock",
            session: "h-2",
            headers: { "x-caller-id": "helpdesk" },
          })
        ).status,
      ).toBe(200);
      // A header that disagrees with the token is refused, not trusted.
      const spoof = await send(handle.url, {
        token: HELPDESK_TOKEN,
        target: "bedrock",
        session: "h-3",
        headers: { "x-caller-id": "triage", "x-request-id": "req-spoof" },
      });
      expect(spoof.status).toBe(401);
      expect(spoof.body.violation?.reason).toContain("x-caller-id");
    } finally {
      await handle.stop();
    }
    const records = await readDecisionLog(logPath);
    const verified = records.find((r) => r.requestId === "req-verified") as RequestRecord;
    expect(verified).toMatchObject({ callerId: "helpdesk", callerVerified: true });
    expect(describeDecision(verified)).toContain("agent helpdesk (verified)");
    const spoof = records.find((r) => r.requestId === "req-spoof");
    expect(spoof && isAuthRecord(spoof) && spoof.claimedCallerId).toBe("triage");
    // Nothing was served for the spoofed request.
    expect(records.filter((r) => isRequestRecord(r) && r.requestId === "req-spoof")).toEqual([]);
  });

  test("the review endpoint authenticates too", async () => {
    const { handle } = twoAgentGateway();
    try {
      const res = await fetch(`${handle.url}/v1/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "max-turns", maxTurns: 4 }),
      });
      expect(res.status).toBe(401);
    } finally {
      await handle.stop();
    }
  });
});

describe("two manifests behind one gateway are enforced differently (4E)", () => {
  test("agent A's token cannot use agent B's model", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      // triage may use the stub, not the frontier model helpdesk is allowed.
      const a = await send(handle.url, { token: TRIAGE_TOKEN, target: "bedrock", session: "t-1" });
      expect(a.status).toBe(422);
      expect(a.body.violation?.policy).toBe("agent-model-not-allowed");
      expect(a.body.violation?.reason).toContain("triage");
      // helpdesk may use the frontier model, not the stub triage is allowed.
      const b = await send(handle.url, { token: HELPDESK_TOKEN, target: "stub", session: "h-1" });
      expect(b.status).toBe(422);
      expect(b.body.violation?.policy).toBe("agent-model-not-allowed");
      // Each on its own model is served.
      expect((await send(handle.url, { token: TRIAGE_TOKEN, session: "t-2" })).status).toBe(200);
      expect(
        (await send(handle.url, { token: HELPDESK_TOKEN, target: "bedrock", session: "h-2" }))
          .status,
      ).toBe(200);
    } finally {
      await handle.stop();
    }
    const blocked = (await readDecisionLog(logPath)).filter(
      (r): r is RequestRecord => isRequestRecord(r) && r.policy === "agent-model-not-allowed",
    );
    expect(blocked.map((r) => r.callerId)).toEqual(["triage", "helpdesk"]);
    for (const r of blocked) expect(r.servedBy).toBeNull();
  });

  test("an agent cannot exceed its own token cap", async () => {
    const { handle } = twoAgentGateway();
    try {
      const over = await send(handle.url, {
        token: TRIAGE_TOKEN,
        session: "t-1",
        request: { ...EMAIL, maxTokens: 801 },
      });
      expect(over.status).toBe(422);
      expect(over.body.violation?.policy).toBe("agent-token-cap");
      expect(over.body.violation?.reason).toContain("800");
      expect(
        (
          await send(handle.url, {
            token: TRIAGE_TOKEN,
            session: "t-2",
            request: { ...EMAIL, maxTokens: 800 },
          })
        ).status,
      ).toBe(200);
      // 300 is within triage's cap but over helpdesk's 200.
      const small = await send(handle.url, {
        token: HELPDESK_TOKEN,
        target: "bedrock",
        session: "h-1",
        request: { ...EMAIL, maxTokens: 300 },
      });
      expect(small.status).toBe(422);
      expect(small.body.violation?.policy).toBe("agent-token-cap");
    } finally {
      await handle.stop();
    }
  });

  test("an agent cannot exceed its own turn cap within a session", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      const h = { token: HELPDESK_TOKEN, target: "bedrock" as const, session: "h-1" };
      expect((await send(handle.url, h)).status).toBe(200);
      const second = await send(handle.url, h);
      expect(second.status).toBe(422);
      expect(second.body.violation?.policy).toBe("agent-turn-cap");
      // A fresh session starts a fresh count.
      expect((await send(handle.url, { ...h, session: "h-2" })).status).toBe(200);
      // triage gets four turns in one session, then is refused.
      for (let i = 0; i < 4; i++) {
        expect((await send(handle.url, { token: TRIAGE_TOKEN, session: "t-1" })).status).toBe(200);
      }
      expect((await send(handle.url, { token: TRIAGE_TOKEN, session: "t-1" })).status).toBe(422);
      // The turn cap counts per session, so a manifest-bound call needs one.
      const none = await send(handle.url, { token: TRIAGE_TOKEN });
      expect(none.status).toBe(422);
      expect(none.body.violation?.policy).toBe("agent-turn-cap");
      expect(none.body.violation?.reason).toContain("session");
    } finally {
      await handle.stop();
    }
    const turnCaps = (await readDecisionLog(logPath)).filter(
      (r) => isRequestRecord(r) && r.policy === "agent-turn-cap",
    );
    expect(turnCaps.length).toBe(3);
    expect(describeDecision(turnCaps[0] as RequestRecord)).toContain("agent-turn-cap");
  });

  test("an L1 agent's response is held for review automatically; an L0 agent's is not", async () => {
    const { handle, logPath } = twoAgentGateway();
    try {
      // No requiresReview flag: the manifest, not the agent, asks for the hold.
      const l1 = await send(handle.url, { token: TRIAGE_TOKEN, session: "t-1" });
      expect(l1.status).toBe(200);
      expect(l1.body.review).toMatchObject({ held: true, trigger: "requested" });
      const l0 = await send(handle.url, {
        token: HELPDESK_TOKEN,
        target: "bedrock",
        session: "h-1",
      });
      expect(l0.status).toBe(200);
      expect(l0.body.review).toBeUndefined();
    } finally {
      await handle.stop();
    }
    const records = await readDecisionLog(logPath);
    const hold = records.find(isReviewRecord);
    expect(hold).toMatchObject({ event: "queued", callerId: "triage" });
    expect(hold?.reason).toContain("L1");
  });

  test("GatewayProvider sends the agent's bearer token and a session, so agent runs are authenticated", async () => {
    const { handle, logPath, queuePath, log } = twoAgentGateway();
    try {
      const client = new GatewayProvider({ url: handle.url, target: "stub", token: TRIAGE_TOKEN });
      const res = await client.generate(EMAIL);
      expect(res.review?.held).toBe(true);
      // Each run gets its own session, so the turn cap is per run.
      const run2 = client.withSession("run-2");
      for (let i = 0; i < 4; i++) await run2.generate(EMAIL);
      await expect(run2.generate(EMAIL)).rejects.toThrow(/agent-turn-cap/);

      // An unknown token surfaces as a refusal, not a crash.
      const stranger = new GatewayProvider({
        url: handle.url,
        target: "stub",
        token: "tok-nobody-0123456789abcdef",
      });
      await expect(stranger.generate(EMAIL)).rejects.toThrow(/caller-auth/);

      // 4D residual closed: the item now names the agent, so the agent cannot approve it.
      const queue = new ReviewQueue(queuePath, log);
      const id = res.review?.id ?? "";
      await expect(queue.approve(id, { as: "triage" })).rejects.toThrow(ReviewQueueError);
    } finally {
      await handle.stop();
    }
    const first = (await readDecisionLog(logPath)).find(isRequestRecord);
    expect(first).toMatchObject({ callerId: "triage", callerVerified: true });
    expect(first?.sessionId).toBeDefined();
  });
});

describe("no manifests: v2 single-agent behaviour is unchanged (4E)", () => {
  test("no token needed; the caller is logged as anonymous, an x-caller-id stays unverified", async () => {
    const dir = tmp();
    const logPath = join(dir, "decisions.jsonl");
    const handle = serveGateway({
      agents: null,
      decisionLog: new DecisionLog(logPath),
      haltFile: join(dir, "no-halt"),
      resolveProvider: () => new StubProvider(),
    });
    try {
      expect((await send(handle.url, { headers: { "x-request-id": "anon" } })).status).toBe(200);
      expect(
        (await send(handle.url, { headers: { "x-request-id": "named", "x-caller-id": "triage" } }))
          .status,
      ).toBe(200);
      // A stray bearer token is not an identity without manifests.
      expect(
        (await send(handle.url, { token: TRIAGE_TOKEN, headers: { "x-request-id": "tok" } }))
          .status,
      ).toBe(200);
    } finally {
      await handle.stop();
    }
    const records = (await readDecisionLog(logPath)).filter(isRequestRecord);
    expect(records.map((r) => [r.requestId, r.callerId, r.callerVerified])).toEqual([
      ["anon", "anonymous", false],
      ["named", "triage", false],
      ["tok", "anonymous", false],
    ]);
    expect(describeDecision(records[0] as RequestRecord)).toContain("an anonymous caller");
  });
});
