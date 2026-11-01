#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-dependency-audit
 *
 * The CI dependency-audit gate (security finding 5, ADR 0022). Runs
 * `bun audit --json` over the whole lockfile, then fails only on advisories at
 * or above `--audit-level` (default `high`) whose vulnerable version is
 * **reachable at runtime**: from any workspace's `dependencies`,
 * `optionalDependencies` or `peerDependencies`, never through a
 * `devDependencies` edge.
 *
 * Why a script and not `bun audit --prod`: Bun 1.3.12's `bun audit` reads the
 * lockfile, not `node_modules`, and silently ignores unknown flags, so
 * `--prod` is accepted and does nothing. The eval harness (`promptfoo`, a dev
 * dependency) would then fail the gate on advisories no one here can fix.
 * This script walks the lockfile graph to tell the two apart. The full-tree
 * count is printed on every run so it stays visible, but it does not gate.
 *
 * "Mechanisms, not prose": this is what makes "no known high-severity
 * vulnerability ships in runtime code" binding. Fails closed: an audit that
 * cannot be read, or a runtime dependency the lockfile cannot resolve, is a
 * failure, not a pass.
 */

const SEVERITIES = ["low", "moderate", "high", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

/** One advisory as `bun audit --json` reports it, keyed by package name. */
export interface Advisory {
  url: string;
  title: string;
  severity: Severity;
  vulnerable_versions: string;
}
export type AuditReport = Record<string, Advisory[]>;

type DepMap = Record<string, string>;
interface DepFields {
  dependencies?: DepMap;
  optionalDependencies?: DepMap;
  peerDependencies?: DepMap;
  optionalPeers?: string[];
}
interface Workspace extends DepFields {
  name?: string;
  devDependencies?: DepMap;
}
/** The subset of `bun.lock` (lockfileVersion 1) this check reads. */
export interface Lockfile {
  workspaces: Record<string, Workspace>;
  packages: Record<string, unknown[]>;
}

/** A package instance installed for runtime: its lockfile key, name and version. */
export interface RuntimePackage {
  key: string;
  name: string;
  version: string;
}

export interface Finding extends RuntimePackage {
  advisory: Advisory;
}

/** Split `a/@s/b/c` into package-name segments: `["a", "@s/b", "c"]`. */
function keySegments(key: string): string[] {
  const parts = key.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as string;
    if (p.startsWith("@") && i + 1 < parts.length) {
      out.push(`${p}/${parts[i + 1]}`);
      i++;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Resolve `dep` as required by the package at lockfile key `from` (Bun's nesting rules). */
function resolveKey(lock: Lockfile, from: string, dep: string): string | undefined {
  const segs = from === "" ? [] : keySegments(from);
  for (let n = segs.length; n >= 0; n--) {
    const key = [...segs.slice(0, n), dep].join("/");
    if (key in lock.packages) return key;
  }
  return undefined;
}

/** Parse a `packages` entry's `name@version` (or `name@workspace:path`). */
function parseIdent(ident: string): { name: string; version: string } {
  const at = ident.lastIndexOf("@");
  if (at <= 0) throw new Error(`unparseable lockfile ident: ${ident}`);
  return { name: ident.slice(0, at), version: ident.slice(at + 1) };
}

function runtimeEdges(fields: DepFields): { dep: string; required: boolean }[] {
  const optionalPeers = new Set(fields.optionalPeers ?? []);
  return [
    ...Object.keys(fields.dependencies ?? {}).map((dep) => ({ dep, required: true })),
    ...Object.keys(fields.optionalDependencies ?? {}).map((dep) => ({ dep, required: false })),
    ...Object.keys(fields.peerDependencies ?? {}).map((dep) => ({
      dep,
      required: !optionalPeers.has(dep),
    })),
  ];
}

/**
 * Every package instance reachable from the workspaces without crossing a
 * `devDependencies` edge. Throws on a required runtime edge the lockfile
 * cannot resolve (fail closed).
 */
export function runtimePackages(lock: Lockfile): RuntimePackage[] {
  const seen = new Map<string, RuntimePackage>();
  const queue: { from: string; fields: DepFields }[] = [];
  const visitedWorkspaces = new Set<string>();

  const enqueueWorkspace = (path: string): void => {
    if (visitedWorkspaces.has(path)) return;
    visitedWorkspaces.add(path);
    const ws = lock.workspaces[path];
    if (!ws) throw new Error(`lockfile has no workspace at ${path}`);
    queue.push({ from: path === "" ? "" : (ws.name ?? ""), fields: ws });
  };
  for (const path of Object.keys(lock.workspaces)) enqueueWorkspace(path);

  while (queue.length > 0) {
    const { from, fields } = queue.shift() as { from: string; fields: DepFields };
    for (const { dep, required } of runtimeEdges(fields)) {
      const key = resolveKey(lock, from, dep);
      if (key === undefined) {
        if (required) {
          throw new Error(`cannot resolve runtime dependency ${dep} of ${from || "root"}`);
        }
        continue;
      }
      if (seen.has(key)) continue;
      const entry = lock.packages[key] as unknown[];
      const { name, version } = parseIdent(String(entry[0]));
      if (version.startsWith("workspace:")) {
        seen.set(key, { key, name, version });
        enqueueWorkspace(version.slice("workspace:".length));
        continue;
      }
      seen.set(key, { key, name, version });
      const meta = entry[2];
      if (meta && typeof meta === "object") queue.push({ from: key, fields: meta as DepFields });
    }
  }
  return [...seen.values()].filter((p) => !p.version.startsWith("workspace:"));
}

/** Advisories at or above `level` whose vulnerable range covers a runtime package. */
export function runtimeFindings(
  audit: AuditReport,
  runtime: RuntimePackage[],
  level: Severity,
): Finding[] {
  const min = SEVERITIES.indexOf(level);
  const findings: Finding[] = [];
  for (const pkg of runtime) {
    for (const advisory of audit[pkg.name] ?? []) {
      if (SEVERITIES.indexOf(advisory.severity) < min) continue;
      if (Bun.semver.satisfies(pkg.version, advisory.vulnerable_versions)) {
        findings.push({ ...pkg, advisory });
      }
    }
  }
  return findings;
}

/** `N advisories (c critical, h high, ...)` over the whole tree, as `bun audit` counts them. */
export function summarise(audit: AuditReport): string {
  const counts = new Map<Severity, number>();
  let total = 0;
  for (const list of Object.values(audit)) {
    for (const a of list) {
      counts.set(a.severity, (counts.get(a.severity) ?? 0) + 1);
      total++;
    }
  }
  const parts = [...SEVERITIES]
    .reverse()
    .filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`);
  return `${total} advisories${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

function parseLevel(argv: string[]): Severity {
  const arg = argv.find((a) => a.startsWith("--audit-level="));
  const level = arg ? arg.slice("--audit-level=".length) : "high";
  if (!(SEVERITIES as readonly string[]).includes(level)) {
    throw new Error(`--audit-level must be one of ${SEVERITIES.join(", ")}; got ${level}`);
  }
  return level as Severity;
}

if (import.meta.main) {
  const level = parseLevel(process.argv.slice(2));
  const proc = Bun.spawnSync(["bun", "audit", "--json"], { stderr: "inherit" });
  let audit: AuditReport;
  try {
    const out = proc.stdout.toString().trim();
    audit = out === "" ? {} : (JSON.parse(out) as AuditReport);
  } catch {
    console.error("✖ dependency audit: could not read `bun audit --json` output; failing closed.");
    process.exit(1);
  }
  const lock = Bun.JSONC.parse(await Bun.file("bun.lock").text()) as Lockfile;
  const runtime = runtimePackages(lock);
  const findings = runtimeFindings(audit, runtime, level);

  console.log(`Full tree (dev included, not gated): ${summarise(audit)}.`);
  if (findings.length > 0) {
    console.error(
      `✖ dependency audit failed: ${findings.length} ${level}+ advisories reach runtime code.\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.name}@${f.version} (${f.key})`);
      console.error(`    ${f.advisory.severity}: ${f.advisory.title} - ${f.advisory.url}`);
    }
    console.error("\nFix with `bun update <pkg>` or a root `overrides` entry. See ADR 0022.");
    process.exit(1);
  }
  console.log(
    `✓ dependency audit passed: no ${level}+ advisories in the ${runtime.length} runtime packages.`,
  );
}
