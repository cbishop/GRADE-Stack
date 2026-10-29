// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module core/release
 *
 * The release manifest (Phase 4C, ADR 0018): the answer to "which version was
 * this?". It names the code (`gitSha`, `dirty`), the prompt (`promptHash`), the
 * model and provider, every tool the agent can call (name plus a hash of its
 * argument schema), the runtime policy (`policyHash`), and when it was built.
 * It is stamped into every eval result and onto the agent's root span, so a
 * regression can be traced to a change and a rollback can name the last good
 * version. {@link diffReleases} turns two manifests into one sentence ("prompt
 * hash changed; model unchanged; tool `lookup_order` added").
 *
 * Hashes are SHA-256 over canonical JSON (sorted keys), so the same prompt,
 * schema or policy always hashes the same way whatever order its keys were
 * written in. The manifest is a strict Zod schema; a malformed one throws.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";

/** Env overrides for builds with no `.git` (a container image, a CI artifact). */
export const GIT_SHA_ENV = "RELIABILITY_GIT_SHA";
export const GIT_DIRTY_ENV = "RELIABILITY_GIT_DIRTY";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** One tool the release can call: its name and a hash of its argument schema. */
export const ReleaseToolSchema = z.strictObject({
  name: z.string().min(1),
  argSchemaHash: Sha256,
});

/** The release manifest. Strict: unknown keys are refused. */
export const ReleaseManifestSchema = z.strictObject({
  v: z.literal(1),
  /** Commit the code was built from; `unknown` when neither git nor the env says. */
  gitSha: z.string().regex(/^([0-9a-f]{7,40}|unknown)$/),
  /** True when tracked files differed from that commit: the sha alone does not name the code. */
  dirty: z.boolean(),
  promptHash: Sha256,
  model: z.string().min(1),
  provider: z.string().min(1),
  tools: z.array(ReleaseToolSchema),
  policyHash: Sha256,
  builtAt: z.iso.datetime(),
});

export type ReleaseTool = z.infer<typeof ReleaseToolSchema>;
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/** Thrown when a manifest (or a result that should carry one) is malformed. */
export class ReleaseManifestError extends Error {
  override name = "ReleaseManifestError";
}

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

/** SHA-256 of a string as-is, or of any other value's canonical JSON. */
export function hashOf(value: unknown): string {
  const text = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Which commit the code came from, and whether tracked files differ from it. */
export interface GitState {
  gitSha: string;
  dirty: boolean;
}

const gitCache = new Map<string, GitState>();

/**
 * Read the git state: `RELIABILITY_GIT_SHA` (and `RELIABILITY_GIT_DIRTY`) win,
 * else `git rev-parse HEAD` and `git status --porcelain` (tracked files only),
 * else `unknown`. Cached per directory: one release per process.
 */
export function readGitState(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): GitState {
  const fromEnv = env[GIT_SHA_ENV];
  if (fromEnv && /^[0-9a-f]{7,40}$/.test(fromEnv)) {
    const d = env[GIT_DIRTY_ENV]?.toLowerCase();
    return { gitSha: fromEnv, dirty: d === "1" || d === "true" };
  }
  const cached = gitCache.get(cwd);
  if (cached) return cached;
  let state: GitState = { gitSha: "unknown", dirty: false };
  try {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
    const sha = head.status === 0 ? head.stdout.trim() : "";
    if (/^[0-9a-f]{40}$/.test(sha)) {
      const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd,
        encoding: "utf8",
      });
      state = { gitSha: sha, dirty: status.status !== 0 || status.stdout.trim().length > 0 };
    }
  } catch {
    // No git binary: the release is honestly `unknown`.
  }
  gitCache.set(cwd, state);
  return state;
}

/** What a release is built from, before hashing. */
export interface ReleaseInput {
  /** The system prompt (or prompt template) the agent sends. */
  prompt: string;
  model: string;
  provider: string;
  /** Each callable tool and its argument schema (any JSON-serializable form). */
  tools: { name: string; argSchema: unknown }[];
  /** The runtime policy the agent runs under (turn bound, limits, output contract). */
  policy: unknown;
  /** Defaults to {@link readGitState}. */
  git?: GitState;
  /** Defaults to now. */
  builtAt?: Date;
}

/** Build and validate a release manifest. Tools are sorted by name. */
export function buildReleaseManifest(input: ReleaseInput): ReleaseManifest {
  const git = input.git ?? readGitState();
  return ReleaseManifestSchema.parse({
    v: 1,
    gitSha: git.gitSha,
    dirty: git.dirty,
    promptHash: hashOf(input.prompt),
    model: input.model,
    provider: input.provider,
    tools: input.tools
      .map((t) => ({ name: t.name, argSchemaHash: hashOf(t.argSchema) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    policyHash: hashOf(input.policy),
    builtAt: (input.builtAt ?? new Date()).toISOString(),
  });
}

/** Validate a manifest; throws {@link ReleaseManifestError} naming the source and field. */
export function parseReleaseManifest(json: unknown, source: string): ReleaseManifest {
  const parsed = ReleaseManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ReleaseManifestError(
      `${source}: release manifest ${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/**
 * The manifest in an eval result (its `release` field) or a bare manifest file.
 * A result with no `release` (one written before Phase 4C) throws: there is no
 * version to compare, and saying so beats guessing.
 */
export function releaseFromJson(json: unknown, source: string): ReleaseManifest {
  if (json && typeof json === "object" && "summary" in json && !("release" in json)) {
    throw new ReleaseManifestError(
      `${source}: this eval result carries no release manifest (written before Phase 4C); re-run it to stamp one`,
    );
  }
  const candidate = json && typeof json === "object" && "release" in json ? json.release : json;
  return parseReleaseManifest(candidate, source);
}

/** A field-by-field comparison of two releases, plus the sentence that explains it. */
export interface ReleaseDiff {
  /** True when anything other than `builtAt` differs. */
  changed: boolean;
  code: { from: string; to: string; changed: boolean; dirty: boolean };
  prompt: { changed: boolean };
  model: { from: string; to: string; changed: boolean };
  provider: { from: string; to: string; changed: boolean };
  policy: { changed: boolean };
  tools: { added: string[]; removed: string[]; argsChanged: string[] };
  /** One sentence, clauses joined by semicolons. */
  sentence: string;
}

const short = (sha: string) => (sha === "unknown" ? sha : sha.slice(0, 7));

/** Compare two releases (`a` the earlier, `b` the later). */
export function diffReleases(a: ReleaseManifest, b: ReleaseManifest): ReleaseDiff {
  const aTools = new Map(a.tools.map((t) => [t.name, t.argSchemaHash]));
  const bTools = new Map(b.tools.map((t) => [t.name, t.argSchemaHash]));
  const added = [...bTools.keys()].filter((n) => !aTools.has(n));
  const removed = [...aTools.keys()].filter((n) => !bTools.has(n));
  const argsChanged = [...bTools.keys()].filter(
    (n) => aTools.has(n) && aTools.get(n) !== bTools.get(n),
  );

  const diff: Omit<ReleaseDiff, "sentence" | "changed"> = {
    code: {
      from: a.gitSha,
      to: b.gitSha,
      changed: a.gitSha !== b.gitSha || a.dirty !== b.dirty,
      dirty: b.dirty,
    },
    prompt: { changed: a.promptHash !== b.promptHash },
    model: { from: a.model, to: b.model, changed: a.model !== b.model },
    provider: { from: a.provider, to: b.provider, changed: a.provider !== b.provider },
    policy: { changed: a.policyHash !== b.policyHash },
    tools: { added, removed, argsChanged },
  };

  const clauses: string[] = [
    diff.prompt.changed ? "prompt hash changed" : "prompt hash unchanged",
    diff.model.changed ? `model changed from ${a.model} to ${b.model}` : "model unchanged",
  ];
  if (diff.provider.changed) clauses.push(`provider changed from ${a.provider} to ${b.provider}`);
  const toolClauses = [
    ...added.map((n) => `tool \`${n}\` added`),
    ...removed.map((n) => `tool \`${n}\` removed`),
    ...argsChanged.map((n) => `tool \`${n}\` arguments changed`),
  ];
  clauses.push(...(toolClauses.length > 0 ? toolClauses : ["tools unchanged"]));
  clauses.push(diff.policy.changed ? "policy hash changed" : "policy hash unchanged");
  const dirtyNote = b.dirty ? " with uncommitted changes" : "";
  clauses.push(
    a.gitSha === b.gitSha
      ? `code at ${short(b.gitSha)}${dirtyNote}${a.dirty !== b.dirty ? ` (was ${a.dirty ? "dirty" : "clean"})` : ""}`
      : `code moved from ${short(a.gitSha)} to ${short(b.gitSha)}${dirtyNote}`,
  );

  const changed =
    diff.code.changed ||
    diff.prompt.changed ||
    diff.model.changed ||
    diff.provider.changed ||
    diff.policy.changed ||
    toolClauses.length > 0;
  const sentence = `${clauses.join("; ")}.`;
  return { ...diff, changed, sentence: sentence.charAt(0).toUpperCase() + sentence.slice(1) };
}

/** Span attribute keys for the manifest on the agent's root span. */
export const RELEASE_ATTRS = {
  gitSha: "grade_stack.release.git_sha",
  dirty: "grade_stack.release.dirty",
  promptHash: "grade_stack.release.prompt_hash",
  model: "grade_stack.release.model",
  provider: "grade_stack.release.provider",
  tools: "grade_stack.release.tools",
  policyHash: "grade_stack.release.policy_hash",
  builtAt: "grade_stack.release.built_at",
} as const;

/** The manifest as root-span attributes (tools as `name@hash8` strings). */
export function releaseSpanAttributes(
  m: ReleaseManifest,
): Record<string, string | boolean | string[]> {
  return {
    [RELEASE_ATTRS.gitSha]: m.gitSha,
    [RELEASE_ATTRS.dirty]: m.dirty,
    [RELEASE_ATTRS.promptHash]: m.promptHash,
    [RELEASE_ATTRS.model]: m.model,
    [RELEASE_ATTRS.provider]: m.provider,
    [RELEASE_ATTRS.tools]: m.tools.map((t) => `${t.name}@${t.argSchemaHash.slice(0, 8)}`),
    [RELEASE_ATTRS.policyHash]: m.policyHash,
    [RELEASE_ATTRS.builtAt]: m.builtAt,
  };
}

/** The manifest as a few plain lines, for `reliability release show`. */
export function describeRelease(m: ReleaseManifest): string[] {
  const tools =
    m.tools.length === 0
      ? "(none)"
      : m.tools.map((t) => `${t.name} (args ${t.argSchemaHash.slice(0, 12)})`).join(", ");
  return [
    `code:     ${m.gitSha}${m.dirty ? " (uncommitted changes: the sha alone does not name this code)" : " (clean)"}`,
    `prompt:   sha256 ${m.promptHash}`,
    `model:    ${m.model} via ${m.provider}`,
    `tools:    ${tools}`,
    `policy:   sha256 ${m.policyHash}`,
    `built at: ${m.builtAt}`,
  ];
}
