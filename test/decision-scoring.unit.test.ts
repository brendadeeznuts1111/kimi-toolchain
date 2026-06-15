import { describe, expect, test } from "bun:test";
import type { FailureTraceRecord } from "../src/lib/failure-ledger.ts";
import { createDecisionRecord, type DecisionRecord } from "../src/lib/decision-ledger.ts";
import { scoreDecision } from "../src/lib/decision-scoring.ts";

function healDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const base = createDecisionRecord({
    decisionId: "decision-heal-1",
    key: "self-heal:cluster-timeout",
    action: "heal cluster timeout",
    trigger: "cluster timeout repeated",
    clusterId: "cluster-timeout",
    rationale: "Apply known timeout repair playbook.",
    outcome: "success",
  });
  return { ...base, ...overrides };
}

describe("decision-scoring", () => {
  test("scores heal/cluster decision at 1.0 when stable for 7 days", () => {
    const decisionTime = new Date("2026-01-01T00:00:00.000Z");
    const decision = healDecision({ timestamp: decisionTime.toISOString() });
    const failures: FailureTraceRecord[] = [
      {
        errorId: "error-other",
        clusterId: "cluster-other",
        timestamp: "2026-01-01T12:00:00.000Z",
      },
    ];

    const score = scoreDecision(decision, {
      now: new Date("2026-01-09T00:00:00.000Z"),
      failures,
    });

    expect(score).toBe(1);
  });

  test("scores heal/cluster decision at 0.2 on recurrence within 24h", () => {
    const decisionTime = new Date("2026-01-01T00:00:00.000Z");
    const decision = healDecision({ timestamp: decisionTime.toISOString() });
    const failures: FailureTraceRecord[] = [
      {
        errorId: "error-recur",
        clusterId: "cluster-timeout",
        timestamp: "2026-01-01T12:00:00.000Z",
      },
    ];

    const score = scoreDecision(decision, {
      now: new Date("2026-01-03T00:00:00.000Z"),
      failures,
    });

    expect(score).toBe(0.2);
  });

  test("increases score for successful corrective child after failed parent", () => {
    const parent = createDecisionRecord({
      decisionId: "decision-parent",
      key: "incident-1",
      action: "deploy change",
      trigger: "release",
      rationale: "Ship release.",
      outcome: "failure",
    });
    const child = createDecisionRecord({
      decisionId: "decision-child",
      key: "incident-1",
      action: "rollback release",
      trigger: "error spike",
      rationale: "Rollback to recover.",
      outcome: "success",
      parentDecisionId: parent.decisionId,
    });

    const score = scoreDecision(child, {
      decisions: [parent, child],
      decisionById: new Map([
        [parent.decisionId, parent],
        [child.decisionId, child],
      ]),
    });

    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  test("scores 1000 decisions in under one second in-memory", () => {
    const records = Array.from({ length: 1000 }, (_, index) =>
      createDecisionRecord({
        decisionId: `decision-${index}`,
        key: "bulk",
        action: "heal cluster timeout",
        trigger: "bulk scoring benchmark",
        clusterId: `cluster-${index % 25}`,
        rationale: "Benchmark decision scoring.",
        outcome: index % 7 === 0 ? "failure" : "success",
      })
    );
    const failures: FailureTraceRecord[] = records
      .filter((_, index) => index % 10 === 0)
      .map((record, index) => ({
        errorId: `error-${index}`,
        clusterId: record.clusterId,
        timestamp: new Date(Date.parse(record.timestamp) + 60 * 60 * 1000).toISOString(),
      }));

    const startedAt = performance.now();
    for (const record of records) {
      scoreDecision(record, { failures, decisions: records });
    }
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1000);
  });
});
