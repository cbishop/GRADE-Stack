#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module cli
 *
 * The `reliability` command-line entry point (Commander) — wires the agent,
 * eval run, eval gate, and scorecard subcommands to the GRADE-Stack packages.
 */

import { readFile } from "node:fs/promises";
import {
  AIRGAP_ENV,
  createDirectProvider,
  createProvider,
  EgressBlockedError,
  formatSpanTree,
  initTracing,
  installEgressGuard,
  installEgressGuardFromEnv,
  StubProvider,
  withInMemoryTracing,
} from "@grade-stack/core";
import {
  baselineFromResult,
  type EvalRunResult,
  evaluateGate,
  formatGateVerdict,
  formatRunResult,
  runEvalSuite,
} from "@grade-stack/evals";
import { ISOLATION_PROBE_BIN, isolatedAgentEnv, serveGateway } from "@grade-stack/gateway";
import { serveHttp, serveStdio } from "@grade-stack/mcp-server";
import {
  buildScorecard,
  computeGovernanceReadiness,
  computeGuardrailCoverage,
  parseEuAiActModule,
  parseOwaspMapping,
  renderCli,
  renderHtml,
  renderMarkdown,
} from "@grade-stack/scorecard";
import { Command } from "commander";
import { connectSupportTools, runReferenceAgent, SAMPLE_EMAIL, selectTool } from "reference-agent";
// Governance mappings are imported (bundled into the build), not read from disk:
// a relative path resolved against import.meta.url breaks once the CLI is bundled
// to dist/ (it overshoots the repo root). Bundling the JSON makes the built
// binary self-contained and the scorecard reproducible anywhere. See ADR 0014.
import euAiActModuleRaw from "../../../governance/eu-ai-act/eu-ai-act-deployer-2026.json" with {
  type: "json",
};
import owaspMappingRaw from "../../../governance/owasp/owasp-agentic-top10-2026.json" with {
  type: "json",
};

// Arm the air-gap egress guard before anything runs, so *every* command honors
// RELIABILITY_AIRGAP=1 (Phase 3D) — not just `sovereign verify`. A no-op when off.
installEgressGuardFromEnv();

const program = new Command();

program
  .name("reliability")
  .description("GRADE-Stack CLI — reliability tooling for mid-market AI agents")
  .version("0.0.0");

/** Validate the bundled OWASP mapping (Phase 3A) and reduce it to guardrail coverage. */
function loadGuardrailCoverage() {
  return computeGuardrailCoverage(parseOwaspMapping(owaspMappingRaw));
}

/** Validate the bundled EU AI Act module (Phase 3C) and reduce it to governance readiness. */
function loadGovernanceReadiness() {
  return computeGovernanceReadiness(parseEuAiActModule(euAiActModuleRaw));
}

const agent = program.command("agent").description("Run and inspect the reference agent");

agent
  .command("run")
  .description("Run the naive reference agent (support-email triage) end to end")
  .option("-p, --provider <provider>", "model provider: bedrock | ollama | stub")
  .option("-m, --max-turns <n>", "enforced upper bound on model turns")
  .option("--degraded", "deliberately worsen the agent (gate canary)")
  .option("--mcp", "consume the MCP server: read the policy resource + select a tool (Phase 2B)")
  .option("--trace", "capture the run's OpenTelemetry trace in-memory and print the span tree")
  .action(
    async (opts: {
      provider?: string;
      maxTurns?: string;
      degraded?: boolean;
      mcp?: boolean;
      trace?: boolean;
    }) => {
      const provider = createProvider(opts.provider);
      const runOpts = {
        maxTurns: opts.maxTurns === undefined ? undefined : Number.parseInt(opts.maxTurns, 10),
        degraded: opts.degraded,
        mcp: opts.mcp,
      };
      const printResult = (result: Awaited<ReturnType<typeof runReferenceAgent>>): void => {
        console.log(`provider: ${result.provider} (${result.model})`);
        console.log(`turns:    ${result.turns}${result.degraded ? "   [DEGRADED]" : ""}`);
        console.log(`tokens:   in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
        if (result.grounding) {
          const sel = result.grounding.selection;
          console.log(
            `mcp:      policy resource loaded; tool selected: ${sel ? sel.tool : "(none)"}`,
          );
        }
        console.log("---");
        console.log(result.raw);
      };

      if (opts.trace) {
        // Hermetic, network-free trace capture — proves a connected trace
        // (plan → tool calls → validation) without needing a backend running.
        const { result, spans, coverage } = await withInMemoryTracing(() =>
          runReferenceAgent(provider, SAMPLE_EMAIL, runOpts),
        );
        printResult(result);
        console.log("\n--- trace ---");
        console.log(formatSpanTree(spans));
        console.log(
          `\nconnected: ${coverage.connected} | spans: ${coverage.totalSpans} | ` +
            `phases: ${coverage.observedPhases.join("→")} | model calls: ${coverage.modelCallSpans} | ` +
            `tool calls: ${coverage.toolCallSpans}`,
        );
        return;
      }

      // Otherwise export to an OTLP backend when opted in (RELIABILITY_OTEL=1 or
      // OTEL_EXPORTER_OTLP_ENDPOINT); a no-op otherwise (off by default).
      const tracing = await initTracing();
      try {
        const result = await runReferenceAgent(provider, SAMPLE_EMAIL, runOpts);
        printResult(result);
        if (tracing.enabled) {
          console.log(`\ntrace exported via OTLP to ${tracing.endpoint}`);
        }
      } finally {
        await tracing.shutdown();
      }
    },
  );

const mcp = program.command("mcp").description("Run and inspect the support MCP server (Phase 2B)");

mcp
  .command("serve")
  .description("Run the support MCP server (stdio by default; --http for remote)")
  .option("--http", "serve over streamable HTTP instead of stdio")
  .option("--port <n>", "HTTP port", "3333")
  .action(async (opts: { http?: boolean; port: string }) => {
    if (opts.http) {
      const handle = serveHttp({ port: Number.parseInt(opts.port, 10) });
      console.error(`support MCP server listening at ${handle.url}`);
    } else {
      await serveStdio();
    }
  });

mcp
  .command("demo")
  .description("Show description-driven tool selection: spawn the server, route two tasks")
  .option("-p, --provider <provider>", "model provider: bedrock | ollama | stub")
  .action(async (opts: { provider?: string }) => {
    const provider = createProvider(opts.provider);
    const client = await connectSupportTools();
    try {
      const tools = await client.listTools();
      console.log(`provider: ${provider.name} (${provider.model})`);
      console.log(`tools discovered: ${tools.map((t) => t.name).join(", ")}`);
      console.log("(the model is shown descriptions only — never these names)\n");
      const tasks = [
        "A customer says they were charged twice and wants a refund — what should we check?",
        "A customer forgot their password and asks how to reset it.",
      ];
      for (const task of tasks) {
        const sel = await selectTool(provider, tools, task);
        console.log(`task: ${task}`);
        console.log(`  → selected: ${sel ? sel.tool : "(none)"}\n`);
      }
    } finally {
      await client.close();
    }
  });

const gateway = program
  .command("gateway")
  .description("Run the LLM gateway and prove server-side guardrails (Phase 2C)");

gateway
  .command("serve")
  .description("Run the credential-holding gateway; the agent talks to it instead of a provider")
  .option("-p, --provider <provider>", "backing model provider: bedrock | ollama | stub")
  .option("--port <n>", "HTTP port", "8787")
  .action((opts: { provider?: string; port: string }) => {
    const backing = opts.provider;
    const handle = serveGateway({
      port: Number.parseInt(opts.port, 10),
      ...(backing ? { resolveProvider: () => createDirectProvider(backing) } : {}),
    });
    console.error(`gateway listening at ${handle.url}`);
    console.error(`set RELIABILITY_GATEWAY_URL=${handle.url} in the agent process`);
  });

gateway
  .command("demo")
  .description("Spawn a credential-isolated agent vs the gateway; prove both enforcement halves")
  .option(
    "-p, --provider <provider>",
    "gateway's backing provider: stub | bedrock | ollama",
    "stub",
  )
  .action(async (opts: { provider: string }) => {
    // The gateway (this process) holds the credentials; it backs every request
    // with the chosen provider regardless of the target the agent names.
    const handle = serveGateway({ resolveProvider: () => createDirectProvider(opts.provider) });
    try {
      const env = isolatedAgentEnv(process.env, handle.url);
      console.log(`gateway up at ${handle.url} (backing provider: ${opts.provider})`);
      console.log("spawning a credential-isolated agent process (AWS creds stripped)...\n");

      const proc = Bun.spawn(["bun", ISOLATION_PROBE_BIN], { env, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;

      const line = out.trim().split("\n").pop() ?? "{}";
      let report: Record<string, unknown> = {};
      try {
        report = JSON.parse(line) as Record<string, unknown>;
      } catch {
        console.error("could not parse probe report:\n", out, err);
        process.exitCode = 1;
        return;
      }

      const tick = (ok: unknown) => (ok ? "✓" : "✗");
      console.log("Behavioral proof (guardrails enforced server-side):");
      console.log(`  ${tick(report.gatewayCallOk)} benign request round-trips through the gateway`);
      console.log(
        `  ${tick(report.bypassBlocked)} bypass-attempt prompt blocked at the gateway` +
          (report.bypassPolicy ? ` (policy: ${report.bypassPolicy})` : ""),
      );
      console.log("\nStructural proof (agent process holds no credentials):");
      console.log(`  ${tick(report.directFactoryRefused)} factory refuses a direct provider here`);
      console.log(
        `  ${tick(report.directProviderFailed)} raw provider call fails (no credentials)`,
      );
      if (Array.isArray(report.notes) && report.notes.length > 0) {
        console.log(`\nnotes: ${(report.notes as string[]).join("; ")}`);
      }
      console.log(`\nprobe exit code: ${code} (0 = every proof held)`);
      process.exitCode = code;
    } finally {
      await handle.stop();
    }
  });

const sovereign = program
  .command("sovereign")
  .description("Sovereign / on-prem (air-gapped) variant (Phase 3D)");

/** A cloud host used as the egress canary — reaching it would break the air gap. */
const EGRESS_CANARY_URL = "https://bedrock-runtime.us-east-1.amazonaws.com/";

sovereign
  .command("verify")
  .description("Prove the full pipeline (agent → evals → scorecard) runs with no cloud dependency")
  .option("-p, --provider <provider>", "local model provider: ollama | stub", "ollama")
  .option("-n, --first-n <n>", "run only the first N eval cases (faster smoke run)")
  .option("-j, --concurrency <n>", "max concurrent eval cases", "3")
  .option("--amortized <usd>", "amortized self-hosting rate (USD/MTok) for the cost line (else $0)")
  .option("--gateway", "also prove the gateway + credential isolation hold air-gapped (Phase 2C)")
  .action(
    async (opts: {
      provider: string;
      firstN?: string;
      concurrency: string;
      amortized?: string;
      gateway?: boolean;
    }) => {
      // Arm the air gap for this process *and* every process it spawns (the
      // promptfoo→bridge eval chain inherits process.env), then install the guard
      // here. The guard is the mechanism; the steps below prove it is live and
      // that the pipeline needs nothing beyond this machine.
      process.env[AIRGAP_ENV] = "1";
      if (opts.amortized) {
        process.env.RELIABILITY_OLLAMA_USD_PER_MTOK = opts.amortized;
      }
      const restore = installEgressGuard();

      const ok = (b: boolean) => (b ? "✓" : "✗");
      let allHeld = true;
      const fail = (msg: string) => {
        allHeld = false;
        console.error(`  ✗ ${msg}`);
      };

      try {
        console.log(`Sovereign / on-prem variant — air-gap verification (${AIRGAP_ENV}=1)\n`);

        // ── Proof 0: the guard actually blocks cloud egress ───────────────────
        let canaryBlocked = false;
        try {
          await fetch(EGRESS_CANARY_URL);
          fail(`egress canary REACHED ${EGRESS_CANARY_URL} — the guard is not enforcing`);
        } catch (err) {
          canaryBlocked = err instanceof EgressBlockedError;
          if (!canaryBlocked) {
            fail(
              `egress canary failed for the wrong reason: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
        console.log("Guard (mechanism is live):");
        console.log(`  ${ok(canaryBlocked)} a call to a cloud host is blocked at the egress guard`);

        // ── Proof: a loopback model endpoint is reachable ─────────────────────
        const provider = createProvider(opts.provider);
        let localReachable = opts.provider === "stub";
        if (opts.provider !== "stub") {
          const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
          try {
            const res = await fetch(`${host}/api/tags`);
            localReachable = res.ok;
            if (!res.ok) fail(`local model host ${host} returned ${res.status}`);
          } catch (err) {
            fail(
              `local model host ${host} unreachable: ${err instanceof Error ? err.message : err} ` +
                "(is Ollama running?)",
            );
          }
        }
        console.log(
          `  ${ok(localReachable)} the local model (${provider.name}) is reachable over loopback\n`,
        );

        // ── Stage 1: the reference agent runs on the local model ──────────────
        console.log("Pipeline (runs entirely on this machine):");
        let agentOk = false;
        try {
          const run = await runReferenceAgent(provider, SAMPLE_EMAIL, {});
          agentOk = run.raw.length > 0;
          console.log(
            `  ${ok(agentOk)} agent: ${run.provider}/${run.model}, ${run.turns} turn(s), ` +
              `${run.usage.inputTokens}+${run.usage.outputTokens} tokens`,
          );
        } catch (err) {
          fail(`agent stage failed: ${err instanceof Error ? err.message : err}`);
        }

        // ── Stage 2: the eval suite runs (subprocess inherits the air gap) ────
        const evalResult = await runEvalSuite({
          provider: opts.provider,
          firstN: opts.firstN === undefined ? undefined : Number.parseInt(opts.firstN, 10),
          concurrency: Number.parseInt(opts.concurrency, 10),
        });
        const s = evalResult.summary;
        const evalsOk = s.total > 0;
        if (!evalsOk) fail("eval suite produced no cases");
        console.log(
          `  ${ok(evalsOk)} evals: ${s.passed}/${s.total} passed ` +
            `(judge: ${evalResult.judgeProvider}, stability ${s.meanStability.toFixed(2)})`,
        );

        // ── Stage 3: the scorecard generates from the offline run ─────────────
        const { coverage } = await withInMemoryTracing(() =>
          runReferenceAgent(new StubProvider(), SAMPLE_EMAIL, {}),
        );
        const card = buildScorecard(evalResult, {
          observability: coverage,
          guardrails: loadGuardrailCoverage(),
          governance: loadGovernanceReadiness(),
        });
        console.log(
          `  ${ok(true)} scorecard: overall ${card.overall.rating} — ${card.overall.headline}\n`,
        );

        // ── Cost/effort: Ollama semantics from the 1B cost config ─────────────
        const cost = s.cost;
        const perSuccess =
          cost.usdPerSuccess === null
            ? "n/a (no passing case)"
            : `$${cost.usdPerSuccess.toFixed(5)}`;
        const tokPerSuccess =
          cost.tokensPerSuccess === null ? "n/a" : `${Math.round(cost.tokensPerSuccess)} tokens`;
        console.log("Cost-per-success (sovereign basis):");
        console.log(
          `  basis: ${cost.basis}   (dollars default to $0; amortized only if a rate is set)`,
        );
        console.log(`  per passing case: ${perSuccess}  ·  ${tokPerSuccess}`);
        console.log(
          `  run total: $${cost.totalUsd.toFixed(5)} over ${s.usage.inputTokens + s.usage.outputTokens} tokens\n`,
        );

        // ── Optional: the gateway + credential isolation hold air-gapped ──────
        if (opts.gateway) {
          console.log("Gateway + credential isolation (air-gapped, Phase 2C):");
          const handle = serveGateway({
            resolveProvider: () => createDirectProvider(opts.provider),
          });
          try {
            const env = { ...isolatedAgentEnv(process.env, handle.url), [AIRGAP_ENV]: "1" };
            const proc = Bun.spawn(["bun", ISOLATION_PROBE_BIN], {
              env,
              stdout: "pipe",
              stderr: "pipe",
            });
            const code = await proc.exited;
            const gatewayOk = code === 0;
            if (!gatewayOk) fail("air-gapped gateway/isolation probe did not pass");
            console.log(
              `  ${ok(gatewayOk)} agent (no creds) reaches the model only via the local gateway; ` +
                "a direct provider call fails\n",
            );
          } finally {
            await handle.stop();
          }
        }

        console.log(
          allHeld
            ? "✓ Sovereign variant verified: the full pipeline ran with no cloud dependency."
            : "✗ Sovereign verification FAILED — see the marks above.",
        );
        process.exitCode = allHeld ? 0 : 1;
      } finally {
        restore();
      }
    },
  );

const evalCmd = program.command("eval").description("Run the reliability eval suite");

evalCmd
  .command("run")
  .description("Execute the eval suite against the reference agent; emit structured results")
  .option("-p, --provider <provider>", "agent model provider: bedrock | ollama")
  .option(
    "-J, --judge-provider <provider>",
    "LLM-as-judge provider (defaults to --provider): bedrock | ollama",
  )
  .option("-r, --repeat <n>", "run each case N times to measure flakiness", "1")
  .option("-j, --concurrency <n>", "max concurrent cases", "3")
  .option("-n, --first-n <n>", "run only the first N cases (smoke run)")
  .option("--json", "emit structured JSON results to stdout instead of a summary")
  .option("-o, --out <file>", "write structured JSON results to a file")
  .action(
    async (opts: {
      provider?: string;
      judgeProvider?: string;
      repeat: string;
      concurrency: string;
      firstN?: string;
      json?: boolean;
      out?: string;
    }) => {
      const result = await runEvalSuite({
        provider: opts.provider,
        judgeProvider: opts.judgeProvider,
        repeats: Number.parseInt(opts.repeat, 10),
        concurrency: Number.parseInt(opts.concurrency, 10),
        firstN: opts.firstN === undefined ? undefined : Number.parseInt(opts.firstN, 10),
      });

      if (opts.out) {
        await Bun.write(opts.out, `${JSON.stringify(result, null, 2)}\n`);
      }
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n${formatRunResult(result)}`);
        if (opts.out) {
          console.log(`\nstructured results written to ${opts.out}`);
        }
      }
      // A failing suite is a real, reportable outcome — exit non-zero so scripts
      // and (in Phase 1B) CI can gate on it.
      if (result.summary.failed > 0) {
        process.exitCode = 1;
      }
    },
  );

evalCmd
  .command("gate")
  .description("Run the suite and fail (exit 1) on a regression vs the committed baseline")
  .option("-p, --provider <provider>", "agent model provider (default: stub for CI)", "stub")
  .option("-J, --judge-provider <provider>", "LLM-as-judge provider (defaults to --provider)")
  .option(
    "-b, --baseline <file>",
    "committed baseline results JSON",
    "packages/evals/baseline.stub.json",
  )
  .option("-t, --tolerance <n>", "allowed drop in passing cases (1A band)", "1")
  .option("--max-cost <usd>", "fail if the run's total cost exceeds this (0 = no cap)", "0")
  .option("-n, --first-n <n>", "run only the first N cases (PR smoke run)")
  .option("-j, --concurrency <n>", "max concurrent cases", "3")
  .action(
    async (opts: {
      provider: string;
      judgeProvider?: string;
      baseline: string;
      tolerance: string;
      maxCost: string;
      firstN?: string;
      concurrency: string;
    }) => {
      let baseline: EvalRunResult;
      try {
        baseline = JSON.parse(await readFile(opts.baseline, "utf8")) as EvalRunResult;
      } catch (err) {
        console.error(
          `Could not read baseline "${opts.baseline}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }

      const result = await runEvalSuite({
        provider: opts.provider,
        judgeProvider: opts.judgeProvider,
        concurrency: Number.parseInt(opts.concurrency, 10),
        firstN: opts.firstN === undefined ? undefined : Number.parseInt(opts.firstN, 10),
      });

      const verdict = evaluateGate(result, baselineFromResult(baseline), {
        toleranceCases: Number.parseInt(opts.tolerance, 10),
        maxUsd: Number.parseFloat(opts.maxCost),
      });

      console.log(`\n${formatRunResult(result)}\n`);
      console.log(formatGateVerdict(verdict));

      if (!verdict.pass) {
        process.exitCode = 1;
      }
    },
  );

program
  .command("scorecard")
  .description("Generate the one-page AI Reliability Scorecard from eval evidence")
  .option("-p, --provider <provider>", "agent model provider: bedrock | ollama | stub")
  .option("-J, --judge-provider <provider>", "LLM-as-judge provider (defaults to --provider)")
  .option("-f, --from <file>", "build from an existing `eval run` results JSON instead of running")
  .option("--degraded", "run the agent in degraded mode (demonstrates honest degradation)")
  .option("--format <fmt>", "output format: md | html | both", "md")
  .option("-o, --out <path>", "write to <path>.md / <path>.html instead of stdout")
  .option("-j, --concurrency <n>", "max concurrent cases", "3")
  .action(
    async (opts: {
      provider?: string;
      judgeProvider?: string;
      from?: string;
      degraded?: boolean;
      format: string;
      out?: string;
      concurrency: string;
    }) => {
      // Degraded mode flows to the agent via env (the eval bridge reads it), so
      // setting it here propagates through the spawned eval run.
      if (opts.degraded) {
        process.env.RELIABILITY_DEGRADED = "1";
      }

      let result: EvalRunResult;
      if (opts.from) {
        try {
          result = JSON.parse(await readFile(opts.from, "utf8")) as EvalRunResult;
        } catch (err) {
          console.error(
            `Could not read results "${opts.from}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      } else {
        result = await runEvalSuite({
          provider: opts.provider,
          judgeProvider: opts.judgeProvider,
          concurrency: Number.parseInt(opts.concurrency, 10),
        });
      }

      // Measure observability coverage with a hermetic, network-free trace probe.
      // Trace coverage is a property of the instrumented agent path, not of which
      // model answers, so the deterministic stub is sufficient and keeps the
      // scorecard runnable offline (incl. with `--from`).
      const { coverage } = await withInMemoryTracing(() =>
        runReferenceAgent(new StubProvider(), SAMPLE_EMAIL, {}),
      );

      // Guardrail coverage (OWASP, Phase 3A) and Governance readiness (EU AI Act,
      // Phase 3C) are derived from the committed governance mappings — properties of
      // the stack's mechanisms, independent of which model answered.
      const guardrails = loadGuardrailCoverage();
      const governance = loadGovernanceReadiness();

      const card = buildScorecard(result, {
        degraded: opts.degraded,
        observability: coverage,
        guardrails,
        governance,
      });

      const wantMd = opts.format === "md" || opts.format === "both";
      const wantHtml = opts.format === "html" || opts.format === "both";

      if (opts.out) {
        if (wantMd) await Bun.write(`${opts.out}.md`, renderMarkdown(card));
        if (wantHtml) await Bun.write(`${opts.out}.html`, renderHtml(card));
        console.log(renderCli(card));
        const written = [wantMd ? `${opts.out}.md` : null, wantHtml ? `${opts.out}.html` : null]
          .filter(Boolean)
          .join(", ");
        console.log(`\nscorecard written to ${written}`);
      } else if (wantHtml && !wantMd) {
        console.log(renderHtml(card));
      } else {
        console.log(renderMarkdown(card));
        if (wantHtml) console.log(renderHtml(card));
      }
    },
  );

await program.parseAsync();
