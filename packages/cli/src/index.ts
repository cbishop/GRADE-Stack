#!/usr/bin/env bun
// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module cli
 *
 * The `reliability` command-line entry point (Commander) — wires the agent,
 * eval run, eval gate, and scorecard subcommands to the GRADE-Stack packages.
 * Phase 4B adds `gateway log` (the decision-log readback) and
 * `scorecard --decision-log` (D's attributable and reconstructable criteria).
 * Phase 4C adds `gateway halt` / `gateway resume` (the kill switch), `release
 * show` / `release diff` (the release manifest), and `scorecard --drills` (D's
 * rollback verified criterion). Phase 4D adds `review list|show|approve|reject`
 * (the human review queue), "held for review" on `agent run`, and `scorecard
 * --review-queue` (G's human oversight criterion). Phase 4E adds `agents
 * list|show` (the manifest readback), the agent and tool-scope lines on `gateway
 * serve` and `mcp serve --http`, and `scorecard --agents` (A's boundary
 * criteria and G's boundary register). Phase 4F adds `eval run --from-traces`
 * (post-deployment re-scoring of the gateway's capture directory) and `--max-cost`,
 * `eval calibrate` (judge-vs-human agreement), `eval record` (the eval record,
 * `docs/eval-record.md`), and `scorecard --eval-record` (E's freshness,
 * calibration and post-deployment criteria).
 */

import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  AIRGAP_ENV,
  createDirectProvider,
  createProvider,
  describeRelease,
  diffReleases,
  EgressBlockedError,
  formatSpanTree,
  GatewayProvider,
  GuardrailError,
  initTracing,
  installEgressGuard,
  installEgressGuardFromEnv,
  MaxTurnsError,
  type ModelProvider,
  type ReleaseManifest,
  releaseFromJson,
  StubProvider,
  withInMemoryTracing,
} from "@grade-stack/core";
import {
  baselineFromResult,
  buildEvalRecord,
  type CalibrationReport,
  calibrate,
  DEFAULT_EVAL_RECORD,
  DEFAULT_LABELS_FILE,
  describeCalibration,
  describeEvalRecord,
  type EvalRunResult,
  evalsRoot,
  evaluateGate,
  formatGateVerdict,
  formatRunResult,
  parseCalibrationLabels,
  parseEvalRecord,
  parseResultsFile,
  type RecordInput,
  renderEvalRecord,
  renderRunHtml,
  renderRunMarkdown,
  runEvalSuite,
  runTraceRescore,
  seedLabels,
  suiteConfigPath,
} from "@grade-stack/evals";
import {
  AGENTS_DIR_ENV,
  configuredTriggers,
  DecisionLog,
  type DecisionRecord,
  deriveReviewItems,
  describeAgent,
  describeDecision,
  describeReviewItem,
  explainAgent,
  explainReviewItem,
  HALT_ENV,
  haltGateway,
  ISOLATION_PROBE_BIN,
  isAuthRecord,
  isAutomatedActor,
  isControlRecord,
  isolatedAgentEnv,
  isRequestRecord,
  isReviewRecord,
  isToolRecord,
  type LoadedManifest,
  loadAgentManifests,
  type ReviewItem,
  type ReviewPolicy,
  ReviewQueue,
  readDecisionLog,
  readLatestDrill,
  readReviewQueue,
  resolveDecisionLogPath,
  resolveHaltFilePath,
  resolveReviewPolicyFromEnv,
  resolveReviewQueuePath,
  resumeGateway,
  serveGateway,
} from "@grade-stack/gateway";
import { serveHttp, serveStdio } from "@grade-stack/mcp-server";
import {
  type AgentBoundaryEvidence,
  type BoundaryObservation,
  buildScorecard,
  computeGovernanceReadiness,
  computeGuardrailCoverage,
  type DecisionLogEvidence,
  type DrillEvidence,
  type EvalRecordEvidence,
  parseBoundaryRegister,
  parseEuAiActModule,
  parseOwaspMapping,
  parseRetentionPeriod,
  type ReviewQueueEvidence,
  renderCli,
  renderHtml,
  renderMarkdown,
} from "@grade-stack/scorecard";
import { Command } from "commander";
import {
  connectSupportTools,
  referenceAgentRelease,
  runReferenceAgent,
  SAMPLE_EMAIL,
  selectTool,
} from "reference-agent";
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

/** Default logging-and-retention record the reconstructable criterion reads (Phase 4B). */
const DEFAULT_LOGGING_RECORD = "docs/logging-and-retention.md";

/** Default boundary register G's boundary register criterion reads (Phase 4E). */
const DEFAULT_BOUNDARY_REGISTER = "docs/autonomy-boundary-register.md";

/** The manifests directory: `--dir`, else RELIABILITY_AGENTS_DIR, else ./agents. */
function agentsDir(explicit?: string): string {
  return explicit ?? process.env[AGENTS_DIR_ENV] ?? "agents";
}

/**
 * Read the agent manifests (each schema-validated; a malformed one throws) and
 * the decision log (every line validated) for A's boundary criteria, plus the
 * boundary register's rows for G (Phase 4E).
 */
async function loadAgentEvidence(
  dir: string,
  logPath: string,
  registerPath: string,
): Promise<AgentBoundaryEvidence> {
  const manifests = loadAgentManifests(dir);
  const observations: BoundaryObservation[] = [];
  for (const r of await readDecisionLog(logPath)) {
    if (isRequestRecord(r)) {
      observations.push({
        kind: "request",
        requestId: r.requestId,
        callerId: r.callerId,
        callerVerified: r.callerVerified,
        action: r.action,
        policy: r.policy,
        held: r.reviewId !== undefined,
      });
    } else if (isToolRecord(r)) {
      observations.push({
        kind: "tool",
        requestId: r.requestId,
        callerId: r.callerId,
        callerVerified: r.callerVerified,
        tool: r.tool,
        action: r.action,
        policy: r.policy,
      });
    } else if (isAuthRecord(r)) {
      observations.push({
        kind: "auth",
        requestId: r.requestId,
        chokepoint: r.chokepoint,
        reason: r.reason,
      });
    }
  }
  let agentIds: string[] | null = null;
  try {
    agentIds = parseBoundaryRegister(await readFile(registerPath, "utf8"));
  } catch {
    agentIds = null;
  }
  return {
    manifestsSource: dir,
    manifests: manifests.map(({ manifest: m, file }) => ({
      id: m.id,
      file,
      owner: m.owner,
      autonomyLevel: m.autonomyLevel,
      allowedTools: m.allowedTools,
      allowedModels: m.allowedModels,
      maxTurns: m.maxTurns,
      tokenCap: m.tokenCap,
      reviewRequired: m.reviewRequired,
    })),
    logSource: logPath,
    observations,
    register: { source: registerPath, agentIds },
  };
}

/**
 * Read and schema-validate a decision log (a malformed line throws, never
 * skipped) plus the logging record's retention period, for the D criteria.
 */
async function loadDecisionLogEvidence(
  logPath: string,
  recordPath: string,
): Promise<DecisionLogEvidence> {
  // Kill-switch control lines (4C) and review lines (4D) are not requests: the
  // D request criteria grade request lines only.
  const records = (await readDecisionLog(logPath)).filter(isRequestRecord);
  let period: string | null = null;
  let source = recordPath;
  try {
    period = parseRetentionPeriod(await readFile(recordPath, "utf8"));
  } catch {
    source = `${recordPath} (not found)`;
  }
  return {
    source: logPath,
    records: records.map((r) => ({
      requestId: r.requestId,
      callerId: r.callerId,
      callerVerified: r.callerVerified,
      contentCaptured: r.contentCaptured,
    })),
    retention: { source, period },
  };
}

/**
 * Read the latest kill-switch drill in `dir` (every record schema-validated; a
 * malformed one throws) for D's *rollback verified* criterion (Phase 4C).
 */
async function loadDrillEvidence(dir: string, asOf: string): Promise<DrillEvidence> {
  const latest = await readLatestDrill(dir);
  if (!latest) return { source: dir, record: null, asOf };
  const r = latest.record;
  return {
    source: latest.path,
    asOf,
    record: {
      date: r.date,
      startedAt: r.startedAt,
      actor: r.actor,
      timeToHaltMs: r.timeToHaltMs,
      thresholdMs: r.thresholdMs,
      providerCallsAfterHalt: r.providerCallsAfterHalt,
      requestsRefused: r.requestsRefused,
      probes: r.probes,
      resumeRestored: r.resumeRestored,
      releaseGitSha: r.release.gitSha,
    },
  };
}

/**
 * Read the review queue (every event schema-validated, the stream derived; a
 * malformed line or an impossible stream throws) for G's *human oversight*
 * criterion (Phase 4D). The configured triggers are the gateway's, resolved
 * from the same `RELIABILITY_REVIEW_*` environment.
 */
async function loadReviewEvidence(path: string): Promise<ReviewQueueEvidence> {
  const items = deriveReviewItems(await readReviewQueue(path), path);
  return {
    source: path,
    configuredTriggers: configuredTriggers(resolveReviewPolicyFromEnv()),
    items: items.map((i) => ({
      id: i.id,
      trigger: i.trigger,
      status: i.status,
      requestId: i.requestId,
      queuedAt: i.queuedAt,
      decidedBy: i.resolution?.by ?? null,
      decidedAt: i.resolution?.at ?? null,
      automated: i.resolution !== null && isAutomatedActor(i.resolution.by, i.callerId),
    })),
  };
}

/** The review triggers a policy switches on, as a short phrase for `gateway serve`. */
function describeTriggers(p: ReviewPolicy): string {
  const on = configuredTriggers(p).map((t) =>
    t === "low-confidence"
      ? `low-confidence (below ${p.reviewBelow?.toFixed(2)} after escalation)`
      : t,
  );
  return on.length > 0 ? on.join(", ") : "none";
}

/**
 * An agent hit its turn bound (Phase 4D): report it to the gateway's review
 * queue when the agent talks to a gateway, and say what happened either way.
 */
async function reportMaxTurns(provider: ModelProvider, err: MaxTurnsError): Promise<void> {
  console.error(`agent did not converge: ${err.message}`);
  if (!(provider instanceof GatewayProvider)) {
    console.error(
      "not queued for review: no gateway is configured (set RELIABILITY_GATEWAY_URL); the review queue lives at the gateway",
    );
    return;
  }
  const res = await provider.requestReview(err);
  if (res.held) {
    console.error(`held for review: ${res.id} (${res.reason})`);
    console.error(`decide with: reliability review show ${res.id}`);
  } else {
    console.error(`not queued for review: ${res.reason}`);
  }
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
          const refused = result.grounding.refused;
          if (refused) {
            console.log(
              `          ${refused.tool} refused by the MCP server: ${refused.policy}: ${refused.reason}`,
            );
          }
        }
        if (result.review.required) {
          console.log(`review:   held for review (${result.review.id}): ${result.review.reason}`);
          console.log(
            `          do not send this draft until a named person approves it: reliability review show ${result.review.id}`,
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
      } catch (err) {
        // A non-converging agent (4D) is held for a person through the gateway.
        if (err instanceof MaxTurnsError) {
          await reportMaxTurns(provider, err);
          process.exitCode = 1;
          return;
        }
        // A gateway refusal (a guardrail, or the 4C kill switch) is an answer,
        // not a crash: say which policy refused and exit non-zero.
        if (!(err instanceof GuardrailError)) throw err;
        console.error(`refused by the gateway: policy ${err.policy}: ${err.message}`);
        process.exitCode = 1;
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
      console.error(
        handle.agents
          ? `tool scope: ${handle.agents.manifests.length} agent manifest(s) from ${process.env[AGENTS_DIR_ENV]}; bearer token required; undeclared tools refused (tool-not-allowed); decision log: ${handle.decisionLogPath}`
          : `tool scope: off (no ${AGENTS_DIR_ENV}); every tool is open to every caller, as in v2`,
      );
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
    console.error(
      `kill switch: halt file ${handle.haltFile} or ${HALT_ENV}=1, checked on every request`,
    );
    console.error(`decision log: ${handle.decisionLogPath} (append-only)`);
    console.error(
      `review queue: ${handle.reviewQueuePath}; holds for a named person: ${describeTriggers(handle.review)}`,
    );
    if (handle.agents) {
      const untokened = handle.agents.untokened();
      console.error(
        `agents: ${handle.agents.manifests.map((m) => `${m.manifest.id} (${m.manifest.autonomyLevel})`).join(", ")} from ${process.env[AGENTS_DIR_ENV]}; bearer token required (401 otherwise)${untokened.length > 0 ? `; no token for: ${untokened.join(", ")}` : ""}`,
      );
    } else {
      console.error(
        `agents: none (no ${AGENTS_DIR_ENV}); single-agent mode, caller ids unverified or anonymous`,
      );
    }
  });

gateway
  .command("log")
  .description("Explain the gateway's decisions, one sentence per request (Phase 4B)")
  .option(
    "-f, --file <path>",
    "decision log (default: RELIABILITY_DECISION_LOG or ./gateway-decisions.jsonl)",
  )
  .option("--since <iso>", "only decisions at or after this ISO time")
  .option("--request <id>", "only this request id")
  .option(
    "--caller <id>",
    "only this caller id (or, for halt, resume and review lines, this actor; for 401 lines, the claimed caller)",
  )
  .option("--json", "print the matching records as JSON")
  .action(
    async (opts: {
      file?: string;
      since?: string;
      request?: string;
      caller?: string;
      json?: boolean;
    }) => {
      const path = opts.file ?? resolveDecisionLogPath();
      const since = opts.since ? Date.parse(opts.since) : undefined;
      if (since !== undefined && Number.isNaN(since)) {
        console.error(`--since "${opts.since}" is not an ISO date or time`);
        process.exitCode = 1;
        return;
      }
      let records: DecisionRecord[];
      try {
        records = await readDecisionLog(path);
      } catch (err) {
        // A missing file or a malformed line: say so loudly, never print a partial log.
        console.error(
          `Could not read decision log: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }
      const matching = records.filter(
        (r) =>
          (since === undefined || Date.parse(r.at) >= since) &&
          (opts.request === undefined || r.requestId === opts.request) &&
          (opts.caller === undefined ||
            (isControlRecord(r)
              ? r.actor === opts.caller
              : isReviewRecord(r)
                ? r.actor === opts.caller || r.callerId === opts.caller
                : isAuthRecord(r)
                  ? r.claimedCallerId === opts.caller
                  : r.callerId === opts.caller)),
      );
      if (opts.json) {
        console.log(JSON.stringify(matching, null, 2));
        return;
      }
      if (matching.length === 0) {
        console.log(`No decisions match in ${path} (${records.length} records in the file).`);
        return;
      }
      for (const r of matching) console.log(describeDecision(r));
    },
  );

/** Shared options for `gateway halt` and `gateway resume`. */
interface KillSwitchCliOptions {
  by: string;
  reason?: string;
  haltFile?: string;
  log?: string;
  json?: boolean;
}

/** Run a kill-switch action and report it; a failure exits 1 with the reason. */
async function killSwitchAction(
  action: "halt" | "resume",
  opts: KillSwitchCliOptions,
): Promise<void> {
  const haltFile = opts.haltFile ?? resolveHaltFilePath();
  const decisionLog = new DecisionLog(opts.log ?? resolveDecisionLogPath());
  const args = { by: opts.by, reason: opts.reason, haltFile, decisionLog };
  try {
    const res = action === "halt" ? await haltGateway(args) : await resumeGateway(args);
    if (opts.json) {
      console.log(JSON.stringify({ ...res, decisionLog: decisionLog.path }, null, 2));
      return;
    }
    switch (res.status) {
      case "halted":
        console.log(describeDecision(res.logLine));
        console.log(`halt file: ${res.haltFile}; logged to ${decisionLog.path}`);
        console.log(
          "Every gateway watching this halt file refuses new requests with policy kill-switch, without a restart.",
        );
        break;
      case "already-halted":
        console.log(
          `Already halted by ${res.record.by} at ${res.record.at}: ${res.record.reason}. Nothing changed; no line logged.`,
        );
        break;
      case "resumed":
        console.log(describeDecision(res.logLine));
        console.log(`removed ${res.haltFile}; logged to ${decisionLog.path}`);
        console.log(
          `If the gateway was started with ${HALT_ENV}=1 it stays halted until restarted without it.`,
        );
        break;
      case "not-halted":
        console.log(
          `Not halted: no halt file at ${res.haltFile}. Nothing changed; no line logged.`,
        );
        break;
    }
  } catch (err) {
    console.error(
      `Could not ${action} the gateway: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

gateway
  .command("halt")
  .description("Pull the kill switch: every request is refused until resume, no restart (4C)")
  .requiredOption("--by <name>", "who is halting the gateway (recorded as the actor)")
  .requiredOption("--reason <text>", "why (recorded in the decision log)")
  .option("--halt-file <path>", "halt file (default: RELIABILITY_HALT_FILE or .reliability-halt)")
  .option(
    "--log <path>",
    "decision log (default: RELIABILITY_DECISION_LOG or ./gateway-decisions.jsonl)",
  )
  .option("--json", "print the result as JSON")
  .action((opts: KillSwitchCliOptions) => killSwitchAction("halt", opts));

gateway
  .command("resume")
  .description("Release the kill switch and restore service (4C)")
  .requiredOption("--by <name>", "who is resuming the gateway (recorded as the actor)")
  .option("--reason <text>", "why (recorded in the decision log)", "operator resumed service")
  .option("--halt-file <path>", "halt file (default: RELIABILITY_HALT_FILE or .reliability-halt)")
  .option(
    "--log <path>",
    "decision log (default: RELIABILITY_DECISION_LOG or ./gateway-decisions.jsonl)",
  )
  .option("--json", "print the result as JSON")
  .action((opts: KillSwitchCliOptions) => killSwitchAction("resume", opts));

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
      console.log("\nHuman review (Phase 4D, the router's third route):");
      console.log(
        `  ${tick(report.heldForReview)} a draft flagged for review is held for a named person` +
          (report.reviewId ? ` (review ${report.reviewId})` : ""),
      );
      if (report.reviewId) {
        console.log(`    decide with: reliability review show ${report.reviewId}`);
        console.log(`    queue: ${handle.reviewQueuePath}`);
      }
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
          resultsSource: "sovereign verify eval run",
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

const agentsCmd = program
  .command("agents")
  .description("Read back the agent manifests: level, owner, tools, models and limits (Phase 4E)");

const AGENTS_DIR_HELP = `manifests directory (default: ${AGENTS_DIR_ENV} or ./agents)`;

/** Load the manifests or say why not (a malformed manifest fails loudly). */
function loadManifestsOrFail(dir: string): LoadedManifest[] | null {
  try {
    return loadAgentManifests(dir);
  } catch (err) {
    console.error(
      `Could not read agent manifests: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return null;
  }
}

agentsCmd
  .command("list")
  .description("One line per agent: level, owner, tools, models, turn and token caps, review")
  .option("-d, --dir <path>", AGENTS_DIR_HELP)
  .option("--json", "print the manifests as JSON")
  .action((opts: { dir?: string; json?: boolean }) => {
    const dir = agentsDir(opts.dir);
    const loaded = loadManifestsOrFail(dir);
    if (!loaded) return;
    if (opts.json) {
      console.log(JSON.stringify(loaded, null, 2));
      return;
    }
    if (loaded.length === 0) {
      console.log(`No agent manifests in ${dir}.`);
      return;
    }
    for (const a of loaded) console.log(describeAgent(a));
    console.log(`\n${loaded.length} agent(s) in ${dir}.`);
  });

agentsCmd
  .command("show")
  .description("Explain one agent's boundary and where each limit is enforced")
  .argument("<id>", "agent id")
  .option("-d, --dir <path>", AGENTS_DIR_HELP)
  .option("--json", "print the manifest as JSON")
  .action((id: string, opts: { dir?: string; json?: boolean }) => {
    const dir = agentsDir(opts.dir);
    const loaded = loadManifestsOrFail(dir);
    if (!loaded) return;
    const agent = loaded.find((a) => a.manifest.id === id);
    if (!agent) {
      console.error(
        `No agent "${id}" in ${dir} (agents: ${loaded.map((a) => a.manifest.id).join(", ") || "none"}).`,
      );
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(agent, null, 2));
      return;
    }
    for (const line of explainAgent(agent)) console.log(line);
  });

const review = program
  .command("review")
  .description("The human review queue: what the gateway held for a named person (Phase 4D)");

const QUEUE_HELP = "review queue (default: RELIABILITY_REVIEW_QUEUE or ./review-queue.jsonl)";
const LOG_HELP = "decision log (default: RELIABILITY_DECISION_LOG or ./gateway-decisions.jsonl)";

/** Read and derive the queue, or say why not and exit 1. A missing file is an empty queue. */
async function loadQueue(
  file?: string,
): Promise<{ queue: ReviewQueue; items: ReviewItem[] } | null> {
  const queue = new ReviewQueue(file ?? resolveReviewQueuePath());
  try {
    return { queue, items: await queue.items() };
  } catch (err) {
    console.error(
      `Could not read review queue: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return null;
  }
}

review
  .command("list")
  .description("List held items, one line each: id, state, trigger, request and why")
  .option("--pending", "only items still waiting for a decision")
  .option("-f, --file <path>", QUEUE_HELP)
  .option("--json", "print the items as JSON")
  .action(async (opts: { pending?: boolean; file?: string; json?: boolean }) => {
    const loaded = await loadQueue(opts.file);
    if (!loaded) return;
    const items = loaded.items.filter((i) => !opts.pending || i.status === "pending");
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    if (items.length === 0) {
      console.log(
        `No ${opts.pending ? "pending " : ""}review items in ${loaded.queue.path} (${loaded.items.length} in the file).`,
      );
      return;
    }
    for (const i of items) console.log(describeReviewItem(i));
    const count = (s: ReviewItem["status"]) => loaded.items.filter((i) => i.status === s).length;
    console.log(
      `\n${loaded.items.length} item(s) in ${loaded.queue.path}: ${count("pending")} pending, ${count("approved")} approved, ${count("rejected")} rejected.`,
    );
  });

review
  .command("show")
  .description("Explain one item: why it was held, what was held, and who decided")
  .argument("<id>", "review item id (rv-...)")
  .option("-f, --file <path>", QUEUE_HELP)
  .option("--json", "print the item as JSON")
  .action(async (id: string, opts: { file?: string; json?: boolean }) => {
    const loaded = await loadQueue(opts.file);
    if (!loaded) return;
    const item = loaded.items.find((i) => i.id === id);
    if (!item) {
      console.error(`No review item ${id} in ${loaded.queue.path}.`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(item, null, 2));
      return;
    }
    for (const line of explainReviewItem(item)) console.log(line);
  });

/** Approve or reject as a named person; print what was recorded, or why not. */
async function decideReview(
  action: "approve" | "reject",
  id: string,
  opts: { as: string; note?: string; reason?: string; file?: string; log?: string; json?: boolean },
): Promise<void> {
  const decisionLog = new DecisionLog(opts.log ?? resolveDecisionLogPath());
  const queue = new ReviewQueue(opts.file ?? resolveReviewQueuePath(), decisionLog);
  try {
    const item =
      action === "approve"
        ? await queue.approve(id, { as: opts.as, ...(opts.note ? { note: opts.note } : {}) })
        : await queue.reject(id, { as: opts.as, reason: opts.reason ?? "" });
    if (opts.json) {
      console.log(JSON.stringify(item, null, 2));
      return;
    }
    const r = item.resolution;
    const extra = r?.event === "rejected" ? `: ${r.reason}` : r?.note ? `: ${r.note}` : "";
    console.log(`Review ${item.id} ${item.status} by ${r?.by} at ${r?.at}${extra}.`);
    console.log(`Recorded in ${queue.path}; logged to ${decisionLog.path}.`);
  } catch (err) {
    console.error(`Could not ${action} ${id}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

review
  .command("approve")
  .description("Release a held item as a named person; records who and when")
  .argument("<id>", "review item id (rv-...)")
  .requiredOption("--as <name>", "who is approving (a person, never the agent or the gateway)")
  .option("--note <text>", "why it is fine to release (recorded)")
  .option("-f, --file <path>", QUEUE_HELP)
  .option("--log <path>", LOG_HELP)
  .option("--json", "print the decided item as JSON")
  .action(
    (
      id: string,
      opts: { as: string; note?: string; file?: string; log?: string; json?: boolean },
    ) => decideReview("approve", id, opts),
  );

review
  .command("reject")
  .description("Refuse a held item as a named person, with a reason; records who and when")
  .argument("<id>", "review item id (rv-...)")
  .requiredOption("--as <name>", "who is rejecting (a person, never the agent or the gateway)")
  .requiredOption("--reason <text>", "why it must not be released (recorded)")
  .option("-f, --file <path>", QUEUE_HELP)
  .option("--log <path>", LOG_HELP)
  .option("--json", "print the decided item as JSON")
  .action(
    (
      id: string,
      opts: { as: string; reason: string; file?: string; log?: string; json?: boolean },
    ) => decideReview("reject", id, opts),
  );

const release = program
  .command("release")
  .description("Show and compare release manifests: which version was this? (Phase 4C)");

release
  .command("show")
  .description("Print the reference agent's current release manifest")
  .option("-p, --provider <provider>", "agent model provider: bedrock | ollama | stub")
  .option("--json", "print the manifest as JSON")
  .action((opts: { provider?: string; json?: boolean }) => {
    const manifest = referenceAgentRelease(createProvider(opts.provider));
    if (opts.json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log("Release manifest (reference agent)");
    for (const line of describeRelease(manifest)) console.log(`  ${line}`);
  });

/** Read the release manifest from an eval result (or a bare manifest) file; throws loudly. */
async function readRelease(path: string): Promise<ReleaseManifest> {
  return releaseFromJson(JSON.parse(await readFile(path, "utf8")) as unknown, path);
}

release
  .command("diff")
  .description("Explain what changed between two eval results' releases, in one sentence")
  .argument("<a>", "the earlier eval result (or manifest) JSON")
  .argument("<b>", "the later eval result (or manifest) JSON")
  .option("--json", "print the field-by-field diff as JSON")
  .action(async (a: string, b: string, opts: { json?: boolean }) => {
    let from: ReleaseManifest;
    let to: ReleaseManifest;
    try {
      from = await readRelease(a);
      to = await readRelease(b);
    } catch (err) {
      console.error(
        `Could not read a release: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
    const diff = diffReleases(from, to);
    if (opts.json) {
      console.log(JSON.stringify({ from: a, to: b, ...diff }, null, 2));
      return;
    }
    console.log(`From ${a} to ${b}: ${diff.sentence}`);
  });

const evalCmd = program.command("eval").description("Run the reliability eval suite");

evalCmd
  .command("report")
  .description("Per-case interaction report (table + full detail) as a Markdown/HTML artifact")
  .option("-p, --provider <provider>", "agent model provider: bedrock | ollama | stub")
  .option("-J, --judge-provider <provider>", "LLM-as-judge provider (defaults to --provider)")
  .option("-f, --from <file>", "build from an existing `eval run` results JSON instead of running")
  .option("--format <fmt>", "output format: md | html | both", "md")
  .option("-o, --out <path>", "write to <path>.md / <path>.html instead of stdout")
  .option("-j, --concurrency <n>", "max concurrent cases", "3")
  .option("-n, --first-n <n>", "run only the first N cases (smoke run)")
  .action(
    async (opts: {
      provider?: string;
      judgeProvider?: string;
      from?: string;
      format: string;
      out?: string;
      concurrency: string;
      firstN?: string;
    }) => {
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
          firstN: opts.firstN === undefined ? undefined : Number.parseInt(opts.firstN, 10),
        });
      }

      const wantMd = opts.format === "md" || opts.format === "both";
      const wantHtml = opts.format === "html" || opts.format === "both";

      if (opts.out) {
        if (wantMd) await Bun.write(`${opts.out}.md`, renderRunMarkdown(result));
        if (wantHtml) await Bun.write(`${opts.out}.html`, renderRunHtml(result));
        const written = [wantMd ? `${opts.out}.md` : null, wantHtml ? `${opts.out}.html` : null]
          .filter(Boolean)
          .join(", ");
        console.log(`interaction report written to ${written}`);
      } else if (wantHtml && !wantMd) {
        console.log(renderRunHtml(result));
      } else {
        console.log(renderRunMarkdown(result));
        if (wantHtml) console.log(renderRunHtml(result));
      }
    },
  );

/** Read and validate one results JSON file. */
async function readResults(file: string): Promise<EvalRunResult> {
  return parseResultsFile(JSON.parse(await readFile(file, "utf8")), file);
}

/** Plain-language lines for a trace re-score: what was read, what failed, by request id. */
function formatTraceRescore(result: EvalRunResult): string {
  const t = result.traces;
  if (!t) return "";
  const lines = [
    `re-scored ${t.rescored} captured production run(s) from ${t.dir}: ${result.summary.passed} passed, ${result.summary.failed} failed (judge: ${result.judgeProvider}).`,
  ];
  if (t.skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const k of t.skipped) reasons.set(k.reason, (reasons.get(k.reason) ?? 0) + 1);
    lines.push(
      `skipped ${t.skipped.length} capture(s): ${[...reasons].map(([r, n]) => `${n} ${r}`).join("; ")}.`,
    );
  }
  for (const c of result.cases.filter((x) => !x.pass)) {
    const failed = c.trace.flatMap((s) => s.checks.filter((k) => !k.pass).map((k) => k.metric));
    lines.push(
      `  request ${c.requestId ?? c.id} from ${c.callerId ?? "an unknown caller"} failed ${failed.join(", ") || "its checks"}; see \`reliability gateway log --request ${c.requestId ?? c.id}\`.`,
    );
  }
  return lines.join("\n");
}

evalCmd
  .command("run")
  .description(
    "Execute the eval suite against the reference agent, or re-score captured production runs (--from-traces); emit structured results. Exit 1 when a case fails, 2 when the cost cap is exceeded",
  )
  .option("-p, --provider <provider>", "agent model provider: bedrock | ollama")
  .option(
    "-J, --judge-provider <provider>",
    "LLM-as-judge provider (defaults to --provider): bedrock | ollama",
  )
  .option(
    "--from-traces <dir>",
    "re-score the gateway's capture directory (RELIABILITY_CAPTURE_DIR) through the suite's assertions instead of running the agent; the judge runs on -J, else -p (4F)",
  )
  .option("-r, --repeat <n>", "run each case N times to measure flakiness", "1")
  .option("-j, --concurrency <n>", "max concurrent cases", "3")
  .option("-n, --first-n <n>", "run only the first N cases (smoke run)")
  .option("--max-cost <usd>", "exit 2 if the run's total cost exceeds this (0 = no cap)", "0")
  .option("--json", "emit structured JSON results to stdout instead of a summary")
  .option("-o, --out <file>", "write structured JSON results to a file")
  .action(
    async (opts: {
      provider?: string;
      judgeProvider?: string;
      fromTraces?: string;
      repeat: string;
      concurrency: string;
      firstN?: string;
      maxCost: string;
      json?: boolean;
      out?: string;
    }) => {
      let result: EvalRunResult;
      if (opts.fromTraces) {
        try {
          result = await runTraceRescore({
            dir: opts.fromTraces,
            judgeProvider: opts.judgeProvider ?? opts.provider,
            concurrency: Number.parseInt(opts.concurrency, 10),
          });
        } catch (err) {
          console.error(
            `Could not re-score "${opts.fromTraces}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      } else {
        result = await runEvalSuite({
          provider: opts.provider,
          judgeProvider: opts.judgeProvider,
          repeats: Number.parseInt(opts.repeat, 10),
          concurrency: Number.parseInt(opts.concurrency, 10),
          firstN: opts.firstN === undefined ? undefined : Number.parseInt(opts.firstN, 10),
        });
      }

      if (opts.out) {
        await Bun.write(opts.out, `${JSON.stringify(result, null, 2)}\n`);
      }
      const maxUsd = Number.parseFloat(opts.maxCost);
      const overCap = maxUsd > 0 && result.summary.cost.totalUsd > maxUsd;
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n${formatRunResult(result)}`);
        if (result.source === "traces") console.log(`\n${formatTraceRescore(result)}`);
        if (opts.out) {
          console.log(`\nstructured results written to ${opts.out}`);
        }
      }
      if (overCap) {
        console.error(
          `COST CAP: run cost $${result.summary.cost.totalUsd.toFixed(4)} exceeds cap $${maxUsd.toFixed(4)}.`,
        );
      }
      // A failing suite is a real, reportable outcome — exit non-zero so scripts
      // and CI can gate on it. The cost cap is a harder failure (exit 2), so the
      // nightly job can record failing cases yet still fail on overspend.
      if (overCap) {
        process.exitCode = 2;
      } else if (result.summary.failed > 0) {
        process.exitCode = 1;
      }
    },
  );

evalCmd
  .command("calibrate")
  .description(
    "Judge-vs-human agreement and Cohen's kappa on the hand-labeled set (4F). Exit 1 below the threshold, 2 when unlabeled or too few labels",
  )
  .option("-l, --labels <file>", "the labels file", DEFAULT_LABELS_FILE)
  .option(
    "--seed <results>",
    "fill unseeded judge verdicts and outputs from a real-model results JSON (never the human labels), write the labels file, then report",
  )
  .option("--json", "print the calibration report as JSON")
  .action(async (opts: { labels: string; seed?: string; json?: boolean }) => {
    let labels: ReturnType<typeof parseCalibrationLabels>;
    try {
      labels = parseCalibrationLabels(JSON.parse(await readFile(opts.labels, "utf8")));
    } catch (err) {
      console.error(
        `Could not read labels "${opts.labels}": ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
    if (opts.seed) {
      try {
        const seeded = seedLabels(labels, await readResults(opts.seed), opts.seed);
        labels = seeded.labels;
        await writeFile(opts.labels, `${JSON.stringify(labels, null, 2)}\n`);
        console.log(
          `seeded ${seeded.seeded} judge verdict(s) from ${opts.seed} into ${opts.labels}; human labels untouched.`,
        );
      } catch (err) {
        console.error(
          `Could not seed from "${opts.seed}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }
    }
    const report = calibrate(labels, opts.labels);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(describeCalibration(report));
      for (const d of report.disagreements) {
        console.log(`  ${d.id}: judge ${d.judge ? "pass" : "fail"}, human ${d.human}`);
      }
    }
    // Seeding is preparation, not a verdict; otherwise the status is the exit code.
    if (!opts.seed) {
      process.exitCode = report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
    }
  });

evalCmd
  .command("record")
  .description(
    "Generate the eval record (docs/eval-record.md): suite hash, committed baselines, last real-model run, judge calibration, last production re-score (4F)",
  )
  .option(
    "-r, --results <files...>",
    "results JSON files: real-model runs (the nightly artifact) and `eval run --from-traces` re-scores",
  )
  .option("-l, --labels <file>", "the calibration labels file", DEFAULT_LABELS_FILE)
  .option(
    "-o, --out <file>",
    "the eval record to write (deployer fields are kept)",
    DEFAULT_EVAL_RECORD,
  )
  .option("--json", "print the computed record as JSON")
  .action(async (opts: { results?: string[]; labels: string; out: string; json?: boolean }) => {
    let record: ReturnType<typeof buildEvalRecord>;
    try {
      const suitePath = suiteConfigPath();
      const suiteText = await readFile(suitePath, "utf8");
      const suite = Bun.YAML.parse(suiteText) as { tests?: unknown[] };
      const root = evalsRoot();
      const baselines: RecordInput[] = [];
      for (const f of readdirSync(root)
        .filter((n) => /^baseline.*\.json$/.test(n))
        .sort()) {
        const file = relative(process.cwd(), join(root, f));
        baselines.push({ file, result: await readResults(join(root, f)) });
      }
      const results: RecordInput[] = [];
      for (const file of opts.results ?? []) {
        results.push({ file, result: await readResults(file) });
      }
      const calibration: CalibrationReport = calibrate(
        parseCalibrationLabels(JSON.parse(await readFile(opts.labels, "utf8"))),
        opts.labels,
      );
      record = buildEvalRecord({
        generatedAt: new Date().toISOString(),
        suite: {
          path: relative(process.cwd(), suitePath),
          text: suiteText,
          caseCount: suite.tests?.length ?? 0,
        },
        baselines,
        results,
        calibration,
      });
      const existing = existsSync(opts.out) ? await readFile(opts.out, "utf8") : undefined;
      await writeFile(opts.out, renderEvalRecord(record, existing));
    } catch (err) {
      console.error(
        `Could not write the eval record: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    for (const line of describeEvalRecord(record)) console.log(line);
    console.log(`\neval record written to ${opts.out}`);
  });

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
  .option(
    "--decision-log <file>",
    "compute D's attributable and reconstructable criteria from a gateway decision log (4B)",
  )
  .option(
    "--logging-record <file>",
    "logging-and-retention record whose retention period the reconstructable criterion reads",
    DEFAULT_LOGGING_RECORD,
  )
  .option(
    "--drills <dir>",
    "compute D's rollback verified criterion from the latest kill-switch drill record in <dir> (4C)",
  )
  .option(
    "--as-of <iso>",
    "date the drill's and the eval record's ages are measured against (default: now); a later date shows them stale",
  )
  .option(
    "--review-queue <file>",
    "compute G's human oversight criterion from a review queue (4D); triggers come from RELIABILITY_REVIEW_*",
  )
  .option(
    "--agents <dir>",
    "compute A's boundary criteria and G's boundary register from the agent manifests in <dir> and the --decision-log (4E)",
  )
  .option(
    "--boundary-register <file>",
    "boundary register whose agent rows G's boundary register criterion reads",
    DEFAULT_BOUNDARY_REGISTER,
  )
  .option(
    "--eval-record <file>",
    "compute E's real-model freshness, judge calibration and post-deployment re-score from the eval record (4F)",
  )
  .action(
    async (opts: {
      provider?: string;
      judgeProvider?: string;
      from?: string;
      degraded?: boolean;
      format: string;
      out?: string;
      concurrency: string;
      decisionLog?: string;
      loggingRecord: string;
      drills?: string;
      asOf?: string;
      reviewQueue?: string;
      agents?: string;
      boundaryRegister: string;
      evalRecord?: string;
    }) => {
      const asOfDate = opts.asOf ? new Date(opts.asOf) : new Date();
      if (Number.isNaN(asOfDate.getTime())) {
        console.error(`--as-of "${opts.asOf}" is not an ISO date or time`);
        process.exitCode = 1;
        return;
      }

      // The eval record: a missing or malformed computed block fails loudly.
      let evalRecord: EvalRecordEvidence | undefined;
      if (opts.evalRecord) {
        try {
          evalRecord = {
            source: opts.evalRecord,
            record: parseEvalRecord(await readFile(opts.evalRecord, "utf8")),
            asOf: asOfDate.toISOString(),
          };
        } catch (err) {
          console.error(
            `Could not read eval record "${opts.evalRecord}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      }

      // A compares declared boundaries with observed calls: it needs the log too.
      let agentEvidence: AgentBoundaryEvidence | undefined;
      if (opts.agents) {
        if (!opts.decisionLog) {
          console.error(
            "--agents needs --decision-log <file>: A compares the manifests with the calls the decision log observed",
          );
          process.exitCode = 1;
          return;
        }
        try {
          agentEvidence = await loadAgentEvidence(
            opts.agents,
            opts.decisionLog,
            opts.boundaryRegister,
          );
        } catch (err) {
          console.error(
            `Could not read agent manifests "${opts.agents}" or decision log "${opts.decisionLog}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      }

      // Read the decision log first: a malformed line fails the command loudly
      // before any eval work, rather than grading from a partial log.
      let decisionLog: DecisionLogEvidence | undefined;
      if (opts.decisionLog) {
        try {
          decisionLog = await loadDecisionLogEvidence(opts.decisionLog, opts.loggingRecord);
        } catch (err) {
          console.error(
            `Could not read decision log "${opts.decisionLog}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      }

      let drill: DrillEvidence | undefined;
      if (opts.drills) {
        const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
        if (Number.isNaN(asOf.getTime())) {
          console.error(`--as-of "${opts.asOf}" is not an ISO date or time`);
          process.exitCode = 1;
          return;
        }
        try {
          drill = await loadDrillEvidence(opts.drills, asOf.toISOString());
        } catch (err) {
          console.error(
            `Could not read drill records in "${opts.drills}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      }

      let reviewQueue: ReviewQueueEvidence | undefined;
      if (opts.reviewQueue) {
        try {
          reviewQueue = await loadReviewEvidence(opts.reviewQueue);
        } catch (err) {
          console.error(
            `Could not read review queue "${opts.reviewQueue}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
      }

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

      // Guardrail coverage (OWASP, graded under A) and Governance readiness (EU AI
      // Act, graded under G) are derived from the committed governance mappings:
      // properties of the stack's mechanisms, independent of which model answered.
      const guardrails = loadGuardrailCoverage();
      const governance = loadGovernanceReadiness();

      const card = buildScorecard(result, {
        degraded: opts.degraded,
        resultsSource: opts.from ?? `live eval run (${result.provider})`,
        observability: coverage,
        guardrails,
        governance,
        ...(decisionLog ? { decisionLog } : {}),
        ...(drill ? { drill } : {}),
        ...(reviewQueue ? { reviewQueue } : {}),
        ...(agentEvidence ? { agents: agentEvidence } : {}),
        ...(evalRecord ? { evalRecord } : {}),
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
