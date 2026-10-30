// Copyright 2026 Inbound Team, LLC dba Clarke Bishop Consulting — https://clarkebishop.com
// SPDX-License-Identifier: Apache-2.0

/**
 * @module evals/label.test
 *
 * Tests for the labeling walk behind `reliability eval label` (Phase 4F, ADR
 * 0021): which entries are walked, the rubric and input lookups against the
 * committed suite, the agent-output pretty-printer, blind screens (no judge
 * verdict before the answer), a save after every answer through an injected
 * answer source, and how the labeler's name is resolved.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CalibrationLabel, CalibrationLabels } from "./calibrate.ts";
import {
  formatAgentOutput,
  formatCaseInput,
  remainingCounts,
  renderEntryScreen,
  renderReveal,
  resolveLabeler,
  rubricFor,
  runLabelSession,
  selectEntries,
  suiteForLabeling,
  wrap,
} from "./label.ts";

const suite = suiteForLabeling(
  Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", "promptfooconfig.yaml"), "utf8")),
);

const TRIAGE = JSON.stringify({
  category: "billing",
  priority: "high",
  sentiment: "negative",
  summary: "Charged twice for the June invoice.",
  draft_reply: "Hi Dana,\n\nWe are looking into the duplicate charge.\n\nBest,\nSupport",
});

function entry(
  caseId: string,
  metric: string,
  judge: CalibrationLabel["judge"],
  human: CalibrationLabel["human"] = null,
): CalibrationLabel {
  return {
    id: `${caseId}/${metric}/1`,
    caseId,
    metric,
    seededFrom: judge === null ? null : "nightly.json@2026-10-30T07:00:00.000Z",
    output: judge === null ? null : TRIAGE,
    judge,
    human,
    labeledBy: human === null ? null : "earlier",
  };
}

function file(labels: CalibrationLabel[]): CalibrationLabels {
  return { v: 1, suite: "packages/evals/promptfooconfig.yaml", instructions: "x", labels };
}

const PASS = { pass: true, score: 1, reason: "Addresses the issue." };
const FAIL = { pass: false, score: 0.65, reason: "Promises a refund timeline." };

/** An answer source that replays a script and records the questions asked. */
function scripted(answers: string[]) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (q: string) => {
      asked.push(q);
      return answers.shift() ?? "q";
    },
  };
}

describe("selectEntries", () => {
  const labels = file([
    entry("billing-duplicate-charge", "validate:judge", PASS),
    entry("technical-login-loop", "validate:judge", null),
    entry("account-cancellation", "validate:judge", FAIL, "fail"),
    entry("empty-body", "validate:judge", FAIL),
  ]);

  test("walks seeded, unlabeled entries only", () => {
    expect(selectEntries(labels).map((l) => l.caseId)).toEqual([
      "billing-duplicate-charge",
      "empty-body",
    ]);
  });

  test("--all adds already-labeled entries but never unseeded ones", () => {
    expect(selectEntries(labels, true).map((l) => l.caseId)).toEqual([
      "billing-duplicate-charge",
      "account-cancellation",
      "empty-body",
    ]);
  });

  test("remaining counts split unlabeled from unseeded", () => {
    expect(remainingCounts(labels)).toEqual({ unlabeled: 2, unseeded: 1 });
  });
});

describe("suite lookups", () => {
  test("validate:judge resolves to the defaultTest rubric for any case", () => {
    expect(rubricFor(suite, "billing-duplicate-charge", "validate:judge")).toContain(
      "The draft_reply is professional in tone",
    );
    expect(rubricFor(suite, "refusal-data-exfiltration", "validate:judge")).toContain(
      "The draft_reply is professional in tone",
    );
  });

  test("validate:judge-safety resolves to the exfiltration case's own rubric", () => {
    expect(rubricFor(suite, "refusal-data-exfiltration", "validate:judge-safety")).toContain(
      "does NOT disclose or fabricate",
    );
    expect(rubricFor(suite, "billing-duplicate-charge", "validate:judge-safety")).toBeUndefined();
  });

  test("every committed label entry finds its input and rubric", () => {
    const committed = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "calibration", "labels.json"), "utf8"),
    ) as CalibrationLabels;
    for (const l of committed.labels) {
      expect(suite.inputs.get(l.caseId), l.id).toBeDefined();
      expect(rubricFor(suite, l.caseId, l.metric), l.id).toBeDefined();
    }
  });

  test("the case input shows from, subject and body; an empty body says so", () => {
    const billing = formatCaseInput(suite.inputs.get("billing-duplicate-charge"));
    expect(billing).toContain("From:    dana@acme-retail.example");
    expect(billing).toContain("Subject: Charged twice for my June invoice");
    expect(billing).toContain("INV-20418");
    expect(formatCaseInput(suite.inputs.get("empty-body"))).toContain("(empty)");
    expect(formatCaseInput(undefined)).toContain("not in the suite");
  });
});

describe("formatAgentOutput", () => {
  test("a triage answer prints one field per line and the reply with real newlines", () => {
    const out = formatAgentOutput(TRIAGE);
    expect(out).toContain("category:  billing");
    expect(out).toContain("priority:  high");
    expect(out).toContain("sentiment: negative");
    expect(out).toContain("summary:   Charged twice for the June invoice.");
    expect(out).toContain("  draft_reply:\n    Hi Dana,\n\n    We are looking into");
    expect(out).not.toContain("\\n");
  });

  test("output that is not a JSON object falls back to the raw text", () => {
    expect(formatAgentOutput("Sorry, I cannot help.")).toContain("raw text");
    expect(formatAgentOutput("Sorry, I cannot help.")).toContain("Sorry, I cannot help.");
    expect(formatAgentOutput("[1,2]")).toContain("raw text");
    expect(formatAgentOutput(null)).toContain("no output");
  });

  test("long lines wrap at the width with a hanging indent", () => {
    const long = wrap(`summary:   ${"word ".repeat(40)}`, 90, "  ", " ".repeat(13));
    for (const line of long.split("\n")) expect(line.length).toBeLessThanOrEqual(90);
    expect(long.split("\n")[1]?.startsWith(" ".repeat(13))).toBe(true);
  });
});

describe("blind screens", () => {
  test("the entry screen shows progress, input, rubric and output, never the judge", () => {
    const e = entry("billing-duplicate-charge", "validate:judge", FAIL);
    const screen = renderEntryScreen(e, 3, 20, suite);
    expect(screen).toContain("3 of 20");
    expect(screen).toContain("billing-duplicate-charge");
    expect(screen).toContain("dana@acme-retail.example");
    expect(screen).toContain("RUBRIC (validate:judge)");
    expect(screen).toContain("category:  billing");
    expect(screen).not.toContain("0.65");
    expect(screen).not.toContain("refund timeline");
    expect(screen.toLowerCase()).not.toContain("judge:");
  });

  test("the reveal names the judge's verdict, reason and agreement", () => {
    const e = entry("billing-duplicate-charge", "validate:judge", FAIL);
    expect(renderReveal(e, "fail")).toContain("Agree.");
    const dis = renderReveal(e, "pass");
    expect(dis).toContain("Judge: fail (score 0.65)");
    expect(dis).toContain("Disagree.");
    expect(dis).toContain("refund timeline");
  });
});

describe("runLabelSession", () => {
  const seeded = () =>
    file([
      entry("billing-duplicate-charge", "validate:judge", FAIL),
      entry("technical-login-loop", "validate:judge", PASS),
      entry("account-cancellation", "validate:judge", PASS),
      entry("empty-body", "validate:judge", null),
    ]);

  test("saves after every answer, records the note and labeler, and reveals after", async () => {
    const saves: CalibrationLabels[] = [];
    const printed: string[] = [];
    // p + note, next; bad key then f, no note, next; skip.
    const { ask } = scripted([
      "p",
      "promised a timeline, but it is fine",
      "",
      "x",
      "f",
      "",
      "",
      "s",
    ]);
    const result = await runLabelSession({
      labels: seeded(),
      suite,
      labeledBy: "clarke",
      ask,
      print: (t) => printed.push(t),
      save: async (l) => {
        saves.push(structuredClone(l));
      },
    });
    expect(saves.length).toBe(2);
    expect(saves[0]?.labels[0]?.human).toBe("pass");
    expect(saves[0]?.labels[0]?.note).toBe("promised a timeline, but it is fine");
    expect(saves[0]?.labels[1]?.human).toBeNull();
    expect(saves[1]?.labels[1]).toMatchObject({ human: "fail", labeledBy: "clarke" });
    expect(saves[1]?.labels[1]?.note).toBeUndefined();
    expect(result.labels.labels[2]?.human).toBeNull(); // skipped
    expect(result).toMatchObject({ labeledNow: 2, agreedNow: 0, quit: false });
    expect(printed).toContain("Type p, f, s or q.");
    // The judge's verdict appears only after the first screen was answered.
    const firstReveal = printed.findIndex((t) => t.includes("Judge: fail"));
    const firstScreen = printed.findIndex((t) => t.includes("1 of 3"));
    expect(firstScreen).toBeGreaterThanOrEqual(0);
    expect(firstReveal).toBeGreaterThan(firstScreen);
  });

  test("quit stops at once and keeps what was already saved", async () => {
    const saves: CalibrationLabels[] = [];
    const { ask } = scripted(["f", "", "q"]);
    const result = await runLabelSession({
      labels: seeded(),
      suite,
      labeledBy: "clarke",
      ask,
      print: () => {},
      save: async (l) => {
        saves.push(l);
      },
    });
    expect(result.quit).toBe(true);
    expect(result.labeledNow).toBe(1);
    expect(result.agreedNow).toBe(1);
    expect(saves.length).toBe(1);
    expect(saves[0]?.labels[0]?.human).toBe("fail");
    expect(saves[0]?.labels[1]?.human).toBeNull();
  });

  test("end of input (q from the reader) at the note prompt saves no note", async () => {
    const saves: CalibrationLabels[] = [];
    const { ask } = scripted(["p"]);
    await runLabelSession({
      labels: seeded(),
      suite,
      labeledBy: "clarke",
      ask,
      print: () => {},
      save: async (l) => {
        saves.push(l);
      },
    });
    expect(saves[0]?.labels[0]?.human).toBe("pass");
    expect(saves[0]?.labels[0]?.note).toBeUndefined();
  });

  test("--all re-reviews a labeled entry and replaces its label", async () => {
    const labels = file([entry("billing-duplicate-charge", "validate:judge", FAIL, "pass")]);
    const printed: string[] = [];
    const { ask } = scripted(["f", ""]);
    const result = await runLabelSession({
      labels,
      suite,
      labeledBy: "clarke",
      all: true,
      ask,
      print: (t) => printed.push(t),
      save: async () => {},
    });
    expect(result.labels.labels[0]).toMatchObject({ human: "fail", labeledBy: "clarke" });
    expect(printed).toContain("Your earlier label was pass.");
  });
});

describe("resolveLabeler", () => {
  const never = async () => {
    throw new Error("should not ask");
  };

  test("--by wins, then the env var, then git", async () => {
    expect(await resolveLabeler({ by: "A", env: "B", gitName: () => "C", ask: never })).toBe("A");
    expect(await resolveLabeler({ env: "B", gitName: () => "C", ask: never })).toBe("B");
    expect(await resolveLabeler({ env: "", gitName: () => "C", ask: never })).toBe("C");
  });

  test("with nothing configured it asks once, re-asking on an empty answer", async () => {
    const s = scripted(["", "Clarke"]);
    expect(await resolveLabeler({ gitName: () => undefined, ask: s.ask })).toBe("Clarke");
    expect(s.asked.length).toBe(2);
  });

  test("quitting at the name prompt is an error, not an anonymous label", async () => {
    await expect(resolveLabeler({ ask: async () => "q" })).rejects.toThrow("no labeler");
  });
});
