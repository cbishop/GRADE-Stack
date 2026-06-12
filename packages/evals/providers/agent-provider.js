// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

// promptfoo custom provider. promptfoo runs on Node, so this file stays plain
// Node-loadable ESM and never imports our Bun/TypeScript code directly. Every
// model call is delegated to the Bun bridge (`src/bridge.ts`), which is the one
// seam to `@grade-stack/core`. Two modes, selected by `config.mode`:
//   - "agent": run the reference agent over the case's SupportEmail vars.
//   - "judge": forward a rendered grading prompt as one raw completion, so the
//     LLM-as-judge metric also flows through the provider abstraction.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(HERE, "../src/bridge.ts");

/** Run the Bun bridge with a JSON request on stdin; resolve its JSON response. */
function callBridge(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("bun", [BRIDGE], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`bridge returned non-JSON (exit ${code}): ${stdout || stderr}`));
        return;
      }
      if (parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      resolvePromise(parsed);
    });
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

export default class GradeStackProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? "grade-stack-agent";
    this.config = options.config ?? {};
    this.mode = this.config.mode ?? "agent";
    // Provider resolution precedence: explicit config → mode-specific env var →
    // undefined (the bridge then falls back to RELIABILITY_PROVIDER / default).
    // The CLI sets EVAL_AGENT_PROVIDER / EVAL_JUDGE_PROVIDER so the agent and
    // judge are independently swappable (e.g. Bedrock agent + Ollama judge).
    const envVar = this.mode === "judge" ? "EVAL_JUDGE_PROVIDER" : "EVAL_AGENT_PROVIDER";
    this.provider = this.config.provider ?? process.env[envVar];
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context = {}) {
    try {
      if (this.mode === "judge") {
        const response = await callBridge({
          mode: "complete",
          provider: this.provider,
          prompt,
        });
        return { output: response.output, tokenUsage: response.tokenUsage };
      }

      const vars = context.vars ?? {};
      const response = await callBridge({
        mode: "agent",
        provider: this.provider,
        email: {
          from: vars.email_from ?? "",
          subject: vars.email_subject ?? "",
          body: vars.email_body ?? prompt,
        },
      });
      return { output: response.output, tokenUsage: response.tokenUsage };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
