// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/label
 *
 * The interactive labeling walk behind `reliability eval label` (Phase 4F, ADR
 * 0021). It replaces hand-editing `labels.json`: for each seeded, unlabeled
 * entry it shows one screen with the email the agent saw, the rubric the judge
 * applied, and the agent's output, then asks pass or fail. The judge's verdict
 * is revealed only after the answer, so the label stays blind. The labels file
 * is written after every answer, so quitting loses nothing.
 *
 * Everything here is pure or driven through injected I/O (`ask`, `print`,
 * `save`), so tests need no TTY. The CLI supplies the real stdin, stdout and
 * file writes.
 */

import {
  type CalibrationLabel,
  type CalibrationLabels,
  parseCalibrationLabels,
} from "./calibrate.ts";

/** Plain-text output wraps at this width. */
export const LABEL_WRAP_WIDTH = 90;

/** The command that seeds judge verdicts, printed when nothing is seeded. */
export const SEED_HINT = "bun run reliability eval calibrate --seed <results.json>";
/** The command to run after labeling. */
export const CALIBRATE_HINT = "bun run reliability eval calibrate";

/** The email one suite case gave the agent. */
export interface CaseInput {
  from: string;
  subject: string;
  body: string;
}

/** What the labeling screens need from the suite definition. */
export interface SuiteForLabeling {
  /** Case id (the test `description`) to the email it sends. */
  inputs: Map<string, CaseInput>;
  /** `llm-rubric` text by metric, from `defaultTest.assert` (applies to every case). */
  defaultRubrics: Map<string, string>;
  /** `llm-rubric` text by case id, then metric, from each test's own `assert`. */
  caseRubrics: Map<string, Map<string, string>>;
}

interface RawAssert {
  type?: unknown;
  metric?: unknown;
  value?: unknown;
}

function rubricsOf(asserts: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(asserts)) return out;
  for (const a of asserts as RawAssert[]) {
    if (a?.type === "llm-rubric" && typeof a.metric === "string" && typeof a.value === "string") {
      out.set(a.metric, a.value.trim());
    }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Read the cases' inputs and the judge rubrics out of the parsed suite
 * (`promptfooconfig.yaml`). A judge metric maps to the `llm-rubric` assertion
 * with the same `metric`: `validate:judge` lives in `defaultTest`, and
 * `validate:judge-safety` on the exfiltration case's own `assert`.
 */
export function suiteForLabeling(suite: unknown): SuiteForLabeling {
  const s = (suite ?? {}) as {
    defaultTest?: { assert?: unknown };
    tests?: { description?: unknown; vars?: Record<string, unknown>; assert?: unknown }[];
  };
  const inputs = new Map<string, CaseInput>();
  const caseRubrics = new Map<string, Map<string, string>>();
  for (const t of s.tests ?? []) {
    const id = str(t?.description);
    if (!id) continue;
    const vars = t.vars ?? {};
    inputs.set(id, {
      from: str(vars.email_from),
      subject: str(vars.email_subject),
      body: str(vars.email_body),
    });
    const own = rubricsOf(t.assert);
    if (own.size > 0) caseRubrics.set(id, own);
  }
  return { inputs, defaultRubrics: rubricsOf(s.defaultTest?.assert), caseRubrics };
}

/** The rubric the judge applied to one case's metric; a case's own assertion wins. */
export function rubricFor(
  suite: SuiteForLabeling,
  caseId: string,
  metric: string,
): string | undefined {
  return suite.caseRubrics.get(caseId)?.get(metric) ?? suite.defaultRubrics.get(metric);
}

/**
 * The entries to walk: seeded (a judge verdict to compare against) and not yet
 * labeled by a person. `all` adds already-labeled entries for re-review.
 */
export function selectEntries(labels: CalibrationLabels, all = false): CalibrationLabel[] {
  return labels.labels.filter((l) => l.judge !== null && (all || l.human === null));
}

/**
 * Word-wrap text to `width` columns, keeping its own line breaks and runs of
 * spaces. Each line starts with `indent`; a wrapped continuation starts with
 * `hang` (default: `indent`), so `summary:` values line up under themselves.
 */
export function wrap(text: string, width = LABEL_WRAP_WIDTH, indent = "", hang = indent): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    let cur = "";
    let lead = indent;
    for (const word of line.trim().split(" ")) {
      const room = Math.max(20, width - lead.length);
      if (cur === "") cur = word;
      else if (cur.length + 1 + word.length <= room || word === "") cur = `${cur} ${word}`;
      else {
        out.push(`${lead}${cur.trimEnd()}`);
        lead = hang;
        cur = word;
      }
    }
    out.push(`${lead}${cur}`);
  }
  return out.join("\n");
}

/** The triage fields shown first, in this order; any others follow. */
const TRIAGE_FIELDS = ["category", "priority", "sentiment", "summary"] as const;

/**
 * The agent output, readable: a JSON triage answer as one field per line with
 * the draft reply's real line breaks, or the raw text when it is not a JSON
 * object (which is also what the judge saw).
 */
export function formatAgentOutput(output: string | null, width = LABEL_WRAP_WIDTH): string {
  if (output === null) return "  (no output seeded)";
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const raw = output.trim() === "" ? "(empty output)" : output;
    return `  (not JSON, shown as the raw text)\n${wrap(raw, width, "  ")}`;
  }
  const o = parsed as Record<string, unknown>;
  const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const lines: string[] = [];
  for (const k of TRIAGE_FIELDS) {
    if (k in o) lines.push(wrap(`${`${k}:`.padEnd(11)}${show(o[k])}`, width, "  ", " ".repeat(13)));
  }
  for (const [k, v] of Object.entries(o)) {
    if ((TRIAGE_FIELDS as readonly string[]).includes(k) || k === "draft_reply") continue;
    lines.push(wrap(`${k}: ${show(v)}`, width, "  "));
  }
  if ("draft_reply" in o) {
    lines.push("  draft_reply:");
    lines.push(wrap(show(o.draft_reply), width, "    "));
  }
  return lines.length > 0 ? lines.join("\n") : "  (an empty JSON object)";
}

/** The email the agent saw, or a note when the case is not in the suite. */
export function formatCaseInput(input: CaseInput | undefined, width = LABEL_WRAP_WIDTH): string {
  if (!input) return "  (this case is not in the suite; the input cannot be shown)";
  const body = input.body.trim() === "" ? "(empty)" : input.body.trim();
  return [
    wrap(`From:    ${input.from || "(none)"}`, width, "  ", " ".repeat(11)),
    wrap(`Subject: ${input.subject || "(none)"}`, width, "  ", " ".repeat(11)),
    "  Body:",
    wrap(body, width, "    "),
  ].join("\n");
}

/** One labeling screen. Never includes the judge's verdict (blind labeling). */
export function renderEntryScreen(
  entry: CalibrationLabel,
  position: number,
  total: number,
  suite: SuiteForLabeling,
  width = LABEL_WRAP_WIDTH,
): string {
  const rubric = rubricFor(suite, entry.caseId, entry.metric);
  return [
    "=".repeat(Math.min(width, 90)),
    `${position} of ${total}   ${entry.caseId}   ${entry.metric}`,
    "",
    "INPUT (the email the agent saw)",
    formatCaseInput(suite.inputs.get(entry.caseId), width),
    "",
    `RUBRIC (${entry.metric})`,
    rubric
      ? wrap(rubric, width, "  ")
      : `  (no llm-rubric with metric ${entry.metric} in the suite)`,
    "",
    "AGENT OUTPUT",
    formatAgentOutput(entry.output, width),
    "",
    "Does the output meet the rubric?",
  ].join("\n");
}

/** After the answer: the judge's verdict and whether the human agrees with it. */
export function renderReveal(
  entry: CalibrationLabel,
  human: "pass" | "fail",
  width = LABEL_WRAP_WIDTH,
): string {
  const j = entry.judge;
  if (!j) return "Judge: no verdict seeded.";
  const verdict = j.pass ? "pass" : "fail";
  const lines = [
    `You: ${human}. Judge: ${verdict} (score ${j.score}). ${verdict === human ? "Agree." : "Disagree."}`,
  ];
  if (j.reason) lines.push(wrap(`Judge's reason: ${j.reason}`, width, "  ", "    "));
  return lines.join("\n");
}

/** Prints a line or block to the person labeling. */
export type Print = (text: string) => void;
/** Asks one question and resolves with the typed line (EOF resolves with "q"). */
export type Ask = (question: string) => Promise<string>;

export interface LabelSessionOptions {
  labels: CalibrationLabels;
  suite: SuiteForLabeling;
  /** Who is labeling; written to `labeledBy`. */
  labeledBy: string;
  /** Include already-labeled entries for re-review. */
  all?: boolean;
  ask: Ask;
  print: Print;
  /** Persist the labels file; called after every pass or fail answer. */
  save: (labels: CalibrationLabels) => Promise<void>;
  /** Called before each entry screen (the CLI clears a TTY). */
  clear?: () => void;
  width?: number;
}

export interface LabelSessionResult {
  labels: CalibrationLabels;
  /** Pass or fail answers given in this session. */
  labeledNow: number;
  /** Agreements with the judge among this session's answers. */
  agreedNow: number;
  quit: boolean;
}

/**
 * Walk the selected entries: one screen each, then `[p]ass [f]ail [s]kip
 * [q]uit`. A pass or fail asks for an optional note, saves the file, then
 * reveals the judge's verdict. Skip leaves the entry as it was.
 */
export async function runLabelSession(opts: LabelSessionOptions): Promise<LabelSessionResult> {
  const width = opts.width ?? LABEL_WRAP_WIDTH;
  let labels: CalibrationLabels = {
    ...opts.labels,
    labels: opts.labels.labels.map((l) => ({ ...l })),
  };
  const queue = selectEntries(labels, opts.all).map((l) => l.id);
  let labeledNow = 0;
  let agreedNow = 0;

  for (const [i, id] of queue.entries()) {
    const entry = labels.labels.find((l) => l.id === id);
    if (!entry) continue;
    opts.clear?.();
    opts.print(renderEntryScreen(entry, i + 1, queue.length, opts.suite, width));
    if (entry.human !== null) {
      opts.print("(Already labeled; your earlier label is shown after you answer.)");
    }

    let choice = "";
    while (!["p", "f", "s", "q"].includes(choice)) {
      choice = (await opts.ask("[p]ass  [f]ail  [s]kip  [q]uit: "))
        .trim()
        .toLowerCase()
        .slice(0, 1);
      if (!["p", "f", "s", "q"].includes(choice)) opts.print("Type p, f, s or q.");
    }
    if (choice === "q") return { labels, labeledNow, agreedNow, quit: true };
    if (choice === "s") continue;

    const human = choice === "p" ? "pass" : "fail";
    const typed = (await opts.ask("Note, one line (Enter to skip): ")).trim();
    // A bare "q" is end of input (or a reflex), never a note worth keeping.
    const note = typed.toLowerCase() === "q" ? "" : typed;
    const previous = entry.human;
    const next: CalibrationLabel = {
      ...entry,
      human,
      labeledBy: opts.labeledBy,
      ...(note ? { note } : {}),
    };
    labels = parseCalibrationLabels({
      ...labels,
      labels: labels.labels.map((l) => (l.id === id ? next : l)),
    });
    await opts.save(labels);
    labeledNow++;
    if (entry.judge && entry.judge.pass === (human === "pass")) agreedNow++;

    opts.print("");
    opts.print(renderReveal(next, human, width));
    if (previous !== null) opts.print(`Your earlier label was ${previous}.`);
    opts.print("Saved.");
    if (i < queue.length - 1) {
      const go = (await opts.ask("Enter for the next one, q to quit: ")).trim().toLowerCase();
      if (go.startsWith("q")) return { labels, labeledNow, agreedNow, quit: true };
    }
  }
  return { labels, labeledNow, agreedNow, quit: false };
}

/**
 * Who is labeling: `--by`, else `$RELIABILITY_LABELER`, else the git user
 * name, else ask once (an empty answer asks again).
 */
export async function resolveLabeler(src: {
  by?: string;
  env?: string;
  gitName?: () => string | undefined;
  ask: Ask;
}): Promise<string> {
  for (const c of [src.by, src.env, src.gitName?.()]) {
    if (c && c.trim() !== "") return c.trim();
  }
  for (;;) {
    const name = (await src.ask("Your name, for labeledBy: ")).trim();
    if (name.toLowerCase() === "q") throw new Error("no labeler name given");
    if (name !== "") return name;
  }
}

/** How many entries still need a person: seeded and unlabeled, and not yet seeded. */
export function remainingCounts(labels: CalibrationLabels): {
  unlabeled: number;
  unseeded: number;
} {
  return {
    unlabeled: labels.labels.filter((l) => l.judge !== null && l.human === null).length,
    unseeded: labels.labels.filter((l) => l.judge === null).length,
  };
}
