// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module cli/stop-hook.test
 *
 * Bite test for the local Claude Code `Stop` hook (Phase 4F): the hook runs the
 * hermetic stub eval gate, lets a healthy tree stop, and blocks (exit 2, the
 * Stop-hook "block" code, with the gate's reason on stderr) when the gate
 * fails. RELIABILITY_DEGRADED=1 is the canary that makes it fail.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const HOOK = join(repoRoot, ".claude", "hooks", "eval-gate.sh");

async function runHook(env: Record<string, string>) {
  const proc = Bun.spawn(["bash", HOOK], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, ...env },
    stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: "Stop" })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

describe("local Stop hook: the stub eval gate", () => {
  test("a healthy tree passes the gate and may stop", async () => {
    const r = await runHook({ RELIABILITY_DEGRADED: "" });
    expect(r.code, r.err).toBe(0);
  }, 120_000);

  test("bite: a regression blocks the stop with exit 2 and says why", async () => {
    const r = await runHook({ RELIABILITY_DEGRADED: "1" });
    expect(r.code).toBe(2);
    expect(r.err).toContain("eval gate failed");
    expect(r.err).toContain("REGRESSION");
  }, 120_000);
});
