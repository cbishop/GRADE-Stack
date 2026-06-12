#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { createProvider } from "@grade-stack/core";
import { formatRunResult, runEvalSuite } from "@grade-stack/evals";
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
  .option("-p, --provider <provider>", "model provider: bedrock | ollama")
  .action(async (opts: { provider?: string }) => {
    const provider = createProvider(opts.provider);
    const result = await runReferenceAgent(provider, SAMPLE_EMAIL);
    console.log(`provider: ${result.provider} (${result.model})`);
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

program
  .command("scorecard")
  .description("Generate the AI Reliability Scorecard (Phase 1C — not yet implemented)")
  .action(() => {
    console.log("`reliability scorecard` lands in Phase 1C.");
  });

await program.parseAsync();
