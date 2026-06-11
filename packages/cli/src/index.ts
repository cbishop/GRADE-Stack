#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

import { createProvider } from "@grade-stack/core";
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

// Placeholder subcommands — wired for real in later phases. They exist now so the
// CLI surface (and `--help`) reflects the planned shape of the stack.
program
  .command("eval")
  .description("Run the eval suite (Phase 1A — not yet implemented)")
  .action(() => {
    console.log("`reliability eval` lands in Phase 1A.");
  });

program
  .command("scorecard")
  .description("Generate the AI Reliability Scorecard (Phase 1C — not yet implemented)")
  .action(() => {
    console.log("`reliability scorecard` lands in Phase 1C.");
  });

await program.parseAsync();
