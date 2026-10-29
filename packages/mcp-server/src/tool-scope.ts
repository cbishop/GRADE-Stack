// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module mcp-server/tool-scope
 *
 * The second chokepoint of Phase 4E (ADR 0020). The gateway sees model calls,
 * not tool calls, so the tool boundary is enforced where tools run: here. A
 * {@link ToolScopeGuard} is bound to one caller (the agent its bearer token
 * authenticated, or the reason it did not) and checks every tool call against
 * that agent's manifest before the tool runs. Every check writes one `tool`
 * line to the decision log (allowed, or refused with `tool-not-allowed`), with
 * the authenticated caller id and a hash of the arguments, never the arguments
 * themselves. An unauthenticated caller's calls are refused with `caller-auth`
 * and logged as `auth` lines.
 *
 * It imports only the manifest and decision-log modules of the gateway package
 * (`@grade-stack/gateway/agent-manifest`, `/decision-log`), never the gateway
 * service, so the MCP server stays free of provider credentials.
 */

import { randomUUID } from "node:crypto";
import {
  type AuthResult,
  resolveAgentRegistryFromEnv,
  toolScope,
} from "@grade-stack/gateway/agent-manifest";
import { DecisionLog, resolveDecisionLogPath, sha256Hex } from "@grade-stack/gateway/decision-log";

/** The env the stdio server reads its caller's token from (the agent spawns it). */
export const AGENT_TOKEN_ENV = "RELIABILITY_AGENT_TOKEN";

/** What a tool call may do: run, or be refused with a policy and a reason. */
export type ToolDecision = { allowed: true } | { allowed: false; policy: string; reason: string };

export interface ToolScopeGuardOptions {
  /** The authentication result for this caller (from `AgentRegistry.authenticate`). */
  caller: AuthResult;
  /** Where each check is recorded. */
  decisionLog: DecisionLog;
  /** Where the caller reached the server, for `auth` lines. Defaults to `tools/call`. */
  endpoint?: string;
}

/** Checks one caller's tool calls against its manifest, logging every decision. */
export class ToolScopeGuard {
  constructor(private readonly opts: ToolScopeGuardOptions) {}

  /** Check (and record) one tool call. Called before the tool's handler runs. */
  async check(tool: string, args: unknown): Promise<ToolDecision> {
    const at = new Date().toISOString();
    const requestId = randomUUID();
    const { caller, decisionLog } = this.opts;
    if (!caller.ok) {
      await decisionLog.append({
        v: 1,
        kind: "auth",
        at,
        requestId,
        chokepoint: "mcp-server",
        endpoint: `${this.opts.endpoint ?? "tools/call"} ${tool}`.slice(0, 200),
        action: "refuse",
        status: 401,
        policy: "caller-auth",
        reason: caller.reason,
        claimedCallerId: null,
      });
      return { allowed: false, policy: "caller-auth", reason: caller.reason };
    }
    const { manifest, file } = caller.agent;
    const scope = toolScope(manifest, tool);
    const reason = scope.allowed ? `${tool} is declared in ${file}` : scope.reason;
    await decisionLog.append({
      v: 1,
      kind: "tool",
      at,
      requestId,
      callerId: manifest.id,
      callerVerified: true,
      autonomyLevel: manifest.autonomyLevel,
      tool,
      action: scope.allowed ? "allow" : "block",
      policy: scope.allowed ? "tool-scope" : "tool-not-allowed",
      reason: reason.slice(0, 500),
      argsSha256: sha256Hex(JSON.stringify(args ?? {})),
    });
    return scope.allowed
      ? { allowed: true }
      : { allowed: false, policy: "tool-not-allowed", reason };
  }
}

/**
 * The guard for a stdio server (Phase 4E). There are no headers on stdio, so
 * the agent that spawns the server passes its token as `RELIABILITY_AGENT_TOKEN`
 * and the server authenticates it once against the manifests in
 * `RELIABILITY_AGENTS_DIR`. Returns null when no manifests are configured (v2).
 * A bad token does not stop the server: every tool call is refused and logged.
 */
export function resolveStdioToolGuard(
  env: Record<string, string | undefined> = process.env,
): ToolScopeGuard | null {
  const agents = resolveAgentRegistryFromEnv(env);
  if (!agents) return null;
  const token = env[AGENT_TOKEN_ENV];
  return new ToolScopeGuard({
    caller: agents.authenticate(token ? `Bearer ${token}` : null),
    decisionLog: new DecisionLog(resolveDecisionLogPath(env)),
    endpoint: "stdio tools/call",
  });
}
