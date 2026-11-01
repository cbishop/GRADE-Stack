// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module scripts/check-dependency-audit.test
 *
 * Proves the dependency-audit gate (ADR 0022) separates runtime from dev-only
 * advisories on a synthetic lockfile: a vulnerable package reached only through
 * a `devDependencies` edge does not fail it, the same package reached through a
 * runtime edge (directly, via another workspace, or as an optional dependency)
 * does, a nested patched copy is judged by its own version, and an unresolvable
 * runtime dependency fails closed.
 */

import { describe, expect, test } from "bun:test";
import {
  type AuditReport,
  type Lockfile,
  runtimeFindings,
  runtimePackages,
  summarise,
} from "./check-dependency-audit.ts";

const lock: Lockfile = {
  workspaces: {
    "": { name: "root", devDependencies: { tool: "1.0.0" } },
    "packages/app": {
      name: "@x/app",
      dependencies: { "@x/lib": "workspace:*", web: "^2.0.0" },
      devDependencies: { harness: "^1.0.0" },
    },
    "packages/lib": { name: "@x/lib", dependencies: { parser: "^1.0.0" } },
  },
  packages: {
    "@x/app": ["@x/app@workspace:packages/app"],
    "@x/lib": ["@x/lib@workspace:packages/lib"],
    tool: ["tool@1.0.0", "", {}, "sha"],
    harness: ["harness@1.0.0", "", { dependencies: { forge: "^1.0.0", parser: "^0.9.0" } }, "sha"],
    "harness/parser": ["parser@0.9.0", "", {}, "sha"],
    forge: ["forge@1.0.0", "", {}, "sha"],
    web: ["web@2.0.0", "", { optionalDependencies: { "@s/addr": "^1.0.0" } }, "sha"],
    "@s/addr": ["@s/addr@1.0.0", "", {}, "sha"],
    parser: ["parser@1.2.0", "", {}, "sha"],
  },
};

const adv = (severity: "low" | "moderate" | "high" | "critical", range: string) => ({
  url: `https://example.test/${severity}`,
  title: `${severity} issue`,
  severity,
  vulnerable_versions: range,
});

describe("dependency audit gate", () => {
  test("walks runtime edges only, through workspaces, nested by key", () => {
    const keys = runtimePackages(lock)
      .map((p) => p.key)
      .sort();
    expect(keys).toEqual(["@s/addr", "parser", "web"]);
  });

  test("a dev-only vulnerable package does not fail the gate", () => {
    const audit: AuditReport = { forge: [adv("critical", "<=1.4.0")] };
    expect(runtimeFindings(audit, runtimePackages(lock), "high")).toEqual([]);
  });

  test("a runtime vulnerable package fails, judged by its installed version", () => {
    const audit: AuditReport = {
      parser: [adv("high", "<1.0.0"), adv("high", "<1.3.0")],
      "@s/addr": [adv("critical", "<2.0.0")],
    };
    const findings = runtimeFindings(audit, runtimePackages(lock), "high");
    expect(findings.map((f) => `${f.key}:${f.advisory.vulnerable_versions}`).sort()).toEqual([
      "@s/addr:<2.0.0",
      "parser:<1.3.0",
    ]);
  });

  test("advisories below the audit level do not gate", () => {
    const audit: AuditReport = { web: [adv("moderate", "<3.0.0")] };
    expect(runtimeFindings(audit, runtimePackages(lock), "high")).toEqual([]);
    expect(runtimeFindings(audit, runtimePackages(lock), "moderate")).toHaveLength(1);
  });

  test("an unresolvable runtime dependency fails closed", () => {
    const broken: Lockfile = {
      workspaces: { "": { name: "root", dependencies: { missing: "^1.0.0" } } },
      packages: {},
    };
    expect(() => runtimePackages(broken)).toThrow(/cannot resolve runtime dependency missing/);
  });

  test("summarise counts the whole tree like bun audit", () => {
    const audit: AuditReport = {
      a: [adv("critical", "*"), adv("low", "*")],
      b: [adv("high", "*")],
    };
    expect(summarise(audit)).toBe("3 advisories (1 critical, 1 high, 1 low)");
  });
});
