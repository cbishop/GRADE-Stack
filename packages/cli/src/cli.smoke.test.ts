// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module cli/cli.smoke.test
 *
 * Built-binary smoke test (ADR 0014). Nothing else exercises the *bundled* CLI,
 * so a post-mortem bug shipped silently: the governance mappings were read from a
 * path relative to `import.meta.url`, which overshoots the repo root once bundled
 * to `dist/`, and `reliability scorecard` crashed from the built binary while
 * every unit test (which runs from source) stayed green. This test builds the CLI
 * the way `bun run build` does and runs `scorecard --from <fixture>` against the
 * artifact, proving the bundled binary resolves the governance data and renders.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCost } from "@grade-stack/evals";

const repoRoot = join(import.meta.dir, "..", "..", "..");
let workDir: string;
let binPath: string;
let fixturePath: string;

/** A deterministic EvalRunResult fixture (no network, no eval subprocess). */
function fixtureResult(): unknown {
  const usage = { inputTokens: 1200, outputTokens: 360 };
  const cases = Array.from({ length: 12 }, (_, i) => ({
    id: `case-${i}`,
    description: `case-${i}`,
    pass: i < 11,
    score: i < 11 ? 1 : 0,
    trace: [],
    output: "{}",
    usage: { inputTokens: 100, outputTokens: 30 },
    stability: 1,
    repeats: 1,
  }));
  return {
    provider: "stub",
    model: "stub-1",
    judgeProvider: "stub",
    timestamp: "2026-06-25T00:00:00.000Z",
    summary: {
      total: 12,
      passed: 11,
      failed: 1,
      passRate: 11 / 12,
      meanStability: 1,
      usage,
      cost: computeCost("stub", "stub-1", usage, 11),
    },
    cases,
  };
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "grade-stack-cli-smoke-"));
  fixturePath = join(workDir, "fixture-eval.json");
  await Bun.write(fixturePath, JSON.stringify(fixtureResult()));

  // Build exactly as `bun run build` does, but into the temp dir.
  const build = Bun.spawn(
    ["bun", "build", "packages/cli/src/index.ts", "--target", "bun", "--outdir", workDir],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  const buildCode = await build.exited;
  if (buildCode !== 0) {
    throw new Error(`build failed: ${await new Response(build.stderr).text()}`);
  }
  binPath = join(workDir, "index.js");
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("built CLI binary (bundled)", () => {
  test("resolves the bundled governance data and renders a scorecard", async () => {
    const proc = Bun.spawn(["bun", binPath, "scorecard", "--from", fixturePath], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(code, `stderr: ${err}`).toBe(0);
    // Guardrail + Governance dimensions only render if the bundled OWASP / EU AI
    // Act mappings loaded — the exact thing the disk-path bug broke.
    expect(out).toContain("Guardrail coverage");
    expect(out).toContain("Governance readiness");
    // The post-mortem fix: out-of-scope threats are reported as boundaries.
    expect(out).toContain("Out of architectural scope");
    expect(out).not.toContain("ENOENT");
  }, 30_000);
});
