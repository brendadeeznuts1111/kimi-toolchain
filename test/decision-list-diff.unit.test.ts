import { describe, expect, test } from "bun:test";
import {
  diffDecisions,
  filterDecisionsByConstant,
  parseDecisionWindow,
  type Decision,
  DECISION_SCHEMA_VERSION,
} from "../src/lib/decision-ledger.ts";

describe("decision-list-diff", () => {
  test("parseDecisionWindow parses day/hour/minute windows", () => {
    expect(parseDecisionWindow("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDecisionWindow("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parseDecisionWindow("30m")).toBe(30 * 60 * 1000);
  });

  test("filterDecisionsByConstant returns constant-linked decisions in window", () => {
    const nowMs = Date.parse("2026-06-16T10:00:00.000Z");
    const decisions: Decision[] = [
      {
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-old",
        timestamp: "2026-06-01T10:00:00.000Z",
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-old" },
        rationale: { summary: "old", fullReasoning: "old", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: { type: "constant-repair", restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"] },
      },
      {
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-new",
        timestamp: "2026-06-15T10:00:00.000Z",
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-new" },
        rationale: { summary: "new", fullReasoning: "new", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-optimization",
          constantKey: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
          candidateValue: 450,
        },
      },
    ];

    const matches = filterDecisionsByConstant(decisions, "KIMI_HOOK_VERIFIER_MAX_CYCLES", {
      sinceMs: nowMs - parseDecisionWindow("7d"),
      nowMs,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.decisionId).toBe("dec-new");
  });

  test("diffDecisions reports changed fields between repairs", () => {
    const base: Decision = {
      schemaVersion: DECISION_SCHEMA_VERSION,
      decisionId: "dec-1289",
      timestamp: "2026-06-15T10:00:00.000Z",
      actor: "kimi",
      action: "config-change",
      trigger: { traceId: "trace-1" },
      rationale: { summary: "repair A", fullReasoning: "repair A", evidence: [] },
      alternatives: [],
      outcome: { result: "success" },
      metadata: {
        type: "constant-repair",
        restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"],
        goldenVersion: "1.0.0",
      },
    };
    const other: Decision = {
      ...base,
      decisionId: "dec-1290",
      timestamp: "2026-06-16T10:00:00.000Z",
      rationale: { summary: "repair B", fullReasoning: "repair B", evidence: [] },
      metadata: {
        type: "constant-repair",
        restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"],
        goldenVersion: "1.0.1",
      },
    };

    const report = diffDecisions(base, other);
    expect(report.leftId).toBe("dec-1289");
    expect(report.rightId).toBe("dec-1290");
    expect(report.fields.some((field) => field.field === "metadata.goldenVersion")).toBe(true);
    expect(report.fields.some((field) => field.field === "rationale.summary")).toBe(true);
  });
});
