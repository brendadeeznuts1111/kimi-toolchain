import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readDecisionLedger,
  recordDecision,
  persistDecisionQualityScores,
} from "../src/lib/decision-ledger.ts";
import { appendFailureRecord } from "../src/lib/failure-ledger.ts";
import { scoreDecisions } from "../src/lib/decision-scoring.ts";

describe("decision-scoring integration", () => {
  test("recurring cluster after heal produces low persisted quality score", async () => {
    const home = join(tmpdir(), `kimi-decision-score-${Bun.randomUUIDv7()}`);
    mkdirSync(home, { recursive: true });
    const decisionPath = join(home, "decision-ledger.jsonl");
    const failurePath = join(home, "tool-failures.jsonl");
    try {
      const healDecision = await recordDecision(
        {
          decisionId: "decision-heal-cluster",
          key: "self-heal:timeout",
          action: "heal cluster timeout",
          trigger: "cluster timeout breach",
          clusterId: "cluster-timeout",
          rationale: "Apply timeout heal playbook.",
          outcome: "success",
        },
        decisionPath
      );

      await appendFailureRecord(
        {
          errorId: "error-timeout-recur",
          clusterId: "cluster-timeout",
          traceId: "trace-timeout",
          timestamp: new Date(
            Date.parse(healDecision.timestamp) + 4 * 60 * 60 * 1000
          ).toISOString(),
          toolName: "kimi-heal",
          output: "cluster timeout recurred after heal",
          taxonomyId: "timeout",
        },
        failurePath
      );

      const records = await readDecisionLedger(decisionPath);
      const updates = await scoreDecisions(records, {
        failurePath,
        now: new Date(Date.parse(healDecision.timestamp) + 8 * 60 * 60 * 1000),
      });
      const persisted = await persistDecisionQualityScores(updates, decisionPath);
      const refreshed = await readDecisionLedger(decisionPath);
      const scored = refreshed.find((record) => record.decisionId === healDecision.decisionId);
      const rawLines = readFileSync(decisionPath, "utf8").trim().split("\n");
      const original = JSON.parse(rawLines[0] ?? "{}") as { qualityScore?: number };
      const scoreUpdate = JSON.parse(rawLines[1] ?? "{}") as {
        metadata?: { scoreUpdateFor?: string; qualityScore?: number };
      };

      expect(updates.get(healDecision.decisionId)).toBe(0.2);
      expect(scored?.qualityScore).toBe(0.2);
      expect(refreshed).toHaveLength(1);
      expect(original.qualityScore).toBeUndefined();
      expect(scoreUpdate.metadata?.scoreUpdateFor).toBe(healDecision.decisionId);
      expect(scoreUpdate.metadata?.qualityScore).toBe(0.2);
      expect(persisted.updated).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
