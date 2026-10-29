// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module gateway/agent-manifest
 *
 * The per-agent manifest and caller authentication (Phase 4E, ADR 0020). A
 * manifest (`agents/<id>.json`, strict Zod schema) declares how much one agent
 * may do: its owner, its autonomy level (L0 suggest only, L1 act with approval,
 * L2 act and notify, L3 autonomous), the tools and models it may use, its turn
 * cap per session and token cap per request, and whether every response is
 * held for review. A malformed manifest throws, naming the file and the field.
 *
 * Agents authenticate with bearer tokens from `RELIABILITY_AGENT_TOKENS`
 * (`id:token,...`) or a tokens file (`RELIABILITY_AGENT_TOKENS_FILE`, else
 * `./.reliability-agent-tokens` when present). Tokens are compared in constant
 * time (SHA-256 digests through `timingSafeEqual`, every stored token checked)
 * and never appear in an error message or a log line.
 *
 * Two chokepoints load the same registry: the gateway (models, token cap, turn
 * cap, review) and the MCP server (tools), because the gateway cannot see tool
 * calls. `RELIABILITY_AGENTS_DIR` switches both on; without it the stack keeps
 * its v2 single-agent behaviour.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { IDENTITY_ID_PATTERN } from "@grade-stack/core";
import { z } from "zod";
import type { GatewayPolicy } from "./policy.ts";

/** Env naming the manifests directory; unset means no manifests (v2 behaviour). */
export const AGENTS_DIR_ENV = "RELIABILITY_AGENTS_DIR";
/** Env holding `id:token` pairs, comma separated. */
export const AGENT_TOKENS_ENV = "RELIABILITY_AGENT_TOKENS";
/** Env naming a tokens file, one `id:token` per line. */
export const AGENT_TOKENS_FILE_ENV = "RELIABILITY_AGENT_TOKENS_FILE";
/** Tokens file read when present and neither env is set. Git-ignored. */
export const DEFAULT_AGENT_TOKENS_FILE = ".reliability-agent-tokens";
/** The caller id logged when no manifests are configured and no caller id is sent. */
export const ANONYMOUS_CALLER = "anonymous";
/** Shortest bearer token accepted: tokens are secrets, not passwords. */
export const MIN_TOKEN_LENGTH = 16;

/** The four autonomy levels, least to most autonomous. */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"] as const;

/** One autonomy level. */
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** What each level means, in a phrase. */
export const AUTONOMY_LEVEL_LABEL: Record<AutonomyLevel, string> = {
  L0: "suggest only",
  L1: "act with approval",
  L2: "act and notify",
  L3: "autonomous",
};

const Id = z.string().regex(IDENTITY_ID_PATTERN);
const ToolName = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);

/** One agent's declared boundary. Strict: an unknown key is a typo, not a setting. */
export const AgentManifestSchema = z
  .strictObject({
    id: Id.refine((v) => v !== ANONYMOUS_CALLER, {
      message: `"${ANONYMOUS_CALLER}" is reserved for unidentified callers`,
    }),
    owner: z.string().trim().min(1).max(200),
    autonomyLevel: z.enum(AUTONOMY_LEVELS),
    allowedTools: z.array(ToolName),
    allowedModels: z.array(z.string().trim().min(1)).min(1),
    maxTurns: z.number().int().min(1).max(1000),
    tokenCap: z.number().int().min(1),
    reviewRequired: z.boolean(),
    description: z.string().max(500).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.autonomyLevel === "L0" && m.allowedTools.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allowedTools"],
        message: "an L0 agent (suggest only) may declare no tools",
      });
    }
    if (m.autonomyLevel === "L1" && !m.reviewRequired) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewRequired"],
        message: "an L1 agent (act with approval) must set reviewRequired: true",
      });
    }
    if (new Set(m.allowedTools).size !== m.allowedTools.length) {
      ctx.addIssue({ code: "custom", path: ["allowedTools"], message: "duplicate tool" });
    }
  });

/** A validated agent manifest. */
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

/** A manifest and the file it came from (cited by the scorecard and the readback). */
export interface LoadedManifest {
  manifest: AgentManifest;
  file: string;
}

/** Thrown for a malformed manifest, token entry or registry. Never swallowed. */
export class AgentManifestError extends Error {
  override name = "AgentManifestError";
}

/** Validate one manifest; any problem throws `source: field: message`. */
export function parseAgentManifest(json: unknown, source: string): AgentManifest {
  const parsed = AgentManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || (issue?.code === "unrecognized_keys" ? "" : "manifest");
    const keys =
      issue && "keys" in issue && Array.isArray(issue.keys) ? ` (${issue.keys.join(", ")})` : "";
    throw new AgentManifestError(
      `${source}: ${field ? `${field}: ` : ""}${issue?.message ?? "invalid"}${keys}`,
    );
  }
  return parsed.data;
}

/**
 * Load every `*.json` in `dir` as a manifest. A missing directory, a file that
 * is not JSON, a malformed manifest, a file named for another id, or two files
 * with one id all throw: a broken boundary must not read as "no boundary".
 */
export function loadAgentManifests(dir: string): LoadedManifest[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new AgentManifestError(`${dir}: agent manifests directory not found`);
  }
  const loaded: LoadedManifest[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new AgentManifestError(`${file}: not valid JSON`);
    }
    const manifest = parseAgentManifest(json, file);
    if (basename(name, ".json") !== manifest.id) {
      throw new AgentManifestError(
        `${file}: id "${manifest.id}" does not match the file name; name it ${manifest.id}.json`,
      );
    }
    loaded.push({ manifest, file });
  }
  return loaded;
}

/**
 * Parse `id:token` entries separated by commas or newlines (`#` starts a
 * comment line). A malformed entry, an unknown-shaped id, a short token or a
 * duplicate id throws, naming the source but never the token.
 */
export function parseAgentTokens(text: string, source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const entries = text
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !e.startsWith("#"));
  for (const [i, entry] of entries.entries()) {
    const colon = entry.indexOf(":");
    const id = colon > 0 ? entry.slice(0, colon).trim() : "";
    const token = colon > 0 ? entry.slice(colon + 1).trim() : "";
    const where = `${source}: entry ${i + 1}`;
    if (!id || !token) throw new AgentManifestError(`${where}: expected id:token`);
    if (!IDENTITY_ID_PATTERN.test(id)) throw new AgentManifestError(`${where}: bad agent id`);
    if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) {
      throw new AgentManifestError(
        `${where}: the token for ${id} must be at least ${MIN_TOKEN_LENGTH} characters with no spaces`,
      );
    }
    if (tokens.has(id)) throw new AgentManifestError(`${where}: duplicate agent id ${id}`);
    tokens.set(id, token);
  }
  return tokens;
}

/**
 * The configured tokens: `RELIABILITY_AGENT_TOKENS`, else the file named by
 * `RELIABILITY_AGENT_TOKENS_FILE`, else `./.reliability-agent-tokens` when it
 * exists, else none. A named file that is missing throws.
 */
export function resolveAgentTokens(
  env: Record<string, string | undefined> = process.env,
): Map<string, string> {
  const inline = env[AGENT_TOKENS_ENV];
  if (inline && inline.trim().length > 0) return parseAgentTokens(inline, AGENT_TOKENS_ENV);
  const named = env[AGENT_TOKENS_FILE_ENV];
  const file = named && named.length > 0 ? named : undefined;
  if (file) {
    if (!existsSync(file)) throw new AgentManifestError(`${file}: agent tokens file not found`);
    return parseAgentTokens(readFileSync(file, "utf8"), file);
  }
  if (existsSync(DEFAULT_AGENT_TOKENS_FILE)) {
    return parseAgentTokens(
      readFileSync(DEFAULT_AGENT_TOKENS_FILE, "utf8"),
      DEFAULT_AGENT_TOKENS_FILE,
    );
  }
  return new Map();
}

/** The outcome of checking an `authorization` header. */
export type AuthResult =
  | { ok: true; agent: LoadedManifest }
  | { ok: false; reason: "no bearer token" | "malformed authorization header" | string };

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * The agents a chokepoint enforces: each manifest and the digest of its token.
 * Constructed only when manifests exist; every token must belong to a manifest
 * and at least one manifest must have a token.
 */
export class AgentRegistry {
  private readonly byId: Map<string, LoadedManifest>;
  private readonly credentials: { id: string; digest: Buffer }[];

  constructor(
    readonly manifests: LoadedManifest[],
    tokens: Map<string, string>,
    readonly source = "",
  ) {
    this.byId = new Map();
    for (const m of manifests) {
      if (this.byId.has(m.manifest.id)) {
        throw new AgentManifestError(`${m.file}: duplicate agent id ${m.manifest.id}`);
      }
      this.byId.set(m.manifest.id, m);
    }
    for (const id of tokens.keys()) {
      if (!this.byId.has(id)) {
        throw new AgentManifestError(
          `a bearer token is configured for agent "${id}", which has no manifest${source ? ` in ${source}` : ""}`,
        );
      }
    }
    if (manifests.length > 0 && tokens.size === 0) {
      throw new AgentManifestError(
        `${manifests.length} agent manifest(s) loaded${source ? ` from ${source}` : ""} but no agent tokens are configured (${AGENT_TOKENS_ENV} or ${AGENT_TOKENS_FILE_ENV}): every request would be refused`,
      );
    }
    this.credentials = [...tokens].map(([id, token]) => ({ id, digest: digest(token) }));
  }

  /** The manifest for an agent id, if any. */
  get(id: string): LoadedManifest | undefined {
    return this.byId.get(id);
  }

  /** Agent ids that have a manifest but no token (they cannot authenticate). */
  untokened(): string[] {
    const withToken = new Set(this.credentials.map((c) => c.id));
    return [...this.byId.keys()].filter((id) => !withToken.has(id));
  }

  /**
   * Check an `authorization` header. Every stored token is compared, in
   * constant time per comparison, so timing does not reveal which agent (if
   * any) a near-miss belongs to. The reason never contains the token.
   */
  authenticate(authorization: string | null | undefined): AuthResult {
    if (!authorization || authorization.trim() === "")
      return { ok: false, reason: "no bearer token" };
    const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
    if (!m?.[1])
      return { ok: false, reason: "malformed authorization header (expected Bearer <token>)" };
    const presented = digest(m[1]);
    let match: string | undefined;
    for (const c of this.credentials) {
      if (timingSafeEqual(presented, c.digest) && match === undefined) match = c.id;
    }
    const agent = match === undefined ? undefined : this.byId.get(match);
    return agent
      ? { ok: true, agent }
      : { ok: false, reason: "unknown bearer token: it matches no configured agent" };
  }
}

/** Load manifests from `dir` and tokens from the environment into a registry. */
export function loadAgentRegistry(
  dir: string,
  env: Record<string, string | undefined> = process.env,
): AgentRegistry {
  return new AgentRegistry(loadAgentManifests(dir), resolveAgentTokens(env), dir);
}

/**
 * The registry the environment configures: `RELIABILITY_AGENTS_DIR` set means
 * manifests are enforced (and must load cleanly); unset means none (v2).
 */
export function resolveAgentRegistryFromEnv(
  env: Record<string, string | undefined> = process.env,
): AgentRegistry | null {
  const dir = env[AGENTS_DIR_ENV];
  if (!dir || dir.length === 0) return null;
  return loadAgentRegistry(dir, env);
}

/**
 * The per-request policy for an agent: its manifest on top of the gateway-wide
 * policy. The model allowlist becomes the manifest's; the token cap becomes the
 * smaller of the two, so a manifest can narrow the gateway's limits but never
 * widen them.
 */
export function manifestPolicy(base: GatewayPolicy, m: AgentManifest): GatewayPolicy {
  return {
    ...base,
    allowedModels: [...m.allowedModels],
    maxTokens: Math.min(base.maxTokens, m.tokenCap),
  };
}

/** Whether an agent may call a tool, and why not. */
export type ToolScopeDecision = { allowed: true } | { allowed: false; reason: string };

/** The tool boundary: an L0 agent calls nothing; others only what they declare. */
export function toolScope(m: AgentManifest, tool: string): ToolScopeDecision {
  if (m.autonomyLevel === "L0") {
    return {
      allowed: false,
      reason: `agent ${m.id} is L0 (suggest only): it may not call tools, and ${tool} was refused`,
    };
  }
  if (!m.allowedTools.includes(tool)) {
    const declared = m.allowedTools.length > 0 ? m.allowedTools.join(", ") : "none";
    return {
      allowed: false,
      reason: `tool ${tool} is not declared in agent ${m.id}'s manifest (declared: ${declared})`,
    };
  }
  return { allowed: true };
}
