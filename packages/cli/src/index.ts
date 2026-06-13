#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { createProvider } from "@grade-stack/core";
import {
  baselineFromResult,
  type EvalRunResult,
  evaluateGate,
  formatGateVerdict,
  formatRunResult,
  runEvalSuite,
} from "@grade-stack/evals";
import { buildScorecard, renderCli, renderHtml, renderMarkdown } from "@grade-stack/scorecard";
import { Command } from "commander";
import { runReferenceAgent, SAMPLE_EMAIL } from "reference-agent";

const program = new Command();

program
  .name("reliability")
  .description("GRADE-Stack CLI — reliability tooling for mid-market AI agents")
  .version("0.0.0");

const agent = program.command("agent").description("Run and inspect the reference agent");

agent
  .command("run")
  .description("Run the naive reference agent (support-email triage) end to end")
  .option("-p, --provider <provider>", "model provider: bedrock | ollama | stub")
  .option("-m, --max-turns <n>", "enforced upper bound on model turns")
  .option("--degraded", "deliberately worsen the agent (gate canary)")
  .action(async (opts: { provider?: string; maxTurns?: string; degraded?: boolean }) => {
    const provider = createProvider(opts.provider);
    const result = await runReferenceAgent(provider, SAMPLE_EMAIL, {
      maxTurns: opts.maxTurns === undefined ? undefined : Number.parseInt(opts.maxTurns, 10),
      degraded: opts.degraded,
    });
    console.log(`provider: ${result.provider} (${result.model})`);
    console.log(`turns:    ${result.turns}${result.degraded ? "   [DEGRADED]" : ""}`);
    console.log(`tokens:   in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
    console.log("---");
    console.log(result.raw);
  });

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

      const card = buildScorecard(result, { degraded: opts.degraded });

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
