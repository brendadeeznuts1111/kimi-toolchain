import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDecisionRecord,
  explainDecision,
  normalizeDecisionRecord,
  readDecisionLedger,
  recordDecision,
} from "../src/lib/decision-ledger.ts";
import { makeDir, readText, removePath } from "./helpers.ts";

describe("decision-ledger", () => {
  test("records and explains a decision by topic", async () => {
    const dir = join(tmpdir(), `kimi-why-${Bun.randomUUIDv7()}`);
    const path = join(dir, "decision-ledger.jsonl");
    makeDir(dir, { recursive: true });
    try {
      const record = await recordDecision(
        {
          key: "typecheck-strict",
          action: "enable strict typecheck",
          trigger: "recurring type drift in CI",
          reasoning: "Strict typecheck catches shared-contract breakage before runtime.",
          alternatives: ["run only oxlint", "skip typecheck on docs changes"],
          outcome: "success",
          traceId: "trace-1",
        },
        path
      );

      const explanation = await explainDecision("typecheck", path);

      expect(record.id.startsWith("decision-")).toBe(true);
      expect(record.schemaVersion).toBe(2);
      expect(explanation.matches).toHaveLength(1);
      expect(explanation.latest?.reasoning).toContain("shared-contract");
      expect(explanation.latest?.alternativesConsidered).toContain("run only oxlint");
    } finally {
      removePath(dir, { recursive: true, force: true });
    }
  });

  test("normalizes legacy v1 ledger lines", () => {
    const record = normalizeDecisionRecord({
      schemaVersion: 1,
      decisionId: "decision-legacy",
      id: "decision-legacy",
      key: "legacy",
      timestamp: "2026-06-15T00:00:00.000Z",
      actor: "user",
      action: "manual fix",
      trigger: "lint failure",
      rationale: "Fixed formatting before commit.",
      alternatives: ["skip hook"],
      outcome: "success",
      traceId: "trace-old",
    });

    expect(record?.schemaVersion).toBe(1);
    expect(record?.trigger.summary).toBe("lint failure");
    expect(record?.rationale.fullReasoning).toContain("formatting");
    expect(record?.outcome.result).toBe("success");
    expect(record?.alternatives[0]?.action).toBe("skip hook");
  });

  test("records structured v2 rationale from template context", async () => {
    const dir = join(tmpdir(), `kimi-decision-${Bun.randomUUIDv7()}`);
    const path = join(dir, "decision-ledger.jsonl");
    makeDir(dir, { recursive: true });
    try {
      const record = await recordDecision(
        {
          key: "self-heal:lockfile",
          action: "bun install",
          trigger: "cluster lockfile_issue exceeded threshold",
          triggerContext: {
            summary: "cluster lockfile_issue exceeded threshold",
            traceId: "trace-heal-1",
            clusterId: "cluster-lockfile",
          },
          rationaleContext: {
            kind: "heal",
            playbookTitle: "regenerate-bun-lockfile",
            clusterId: "cluster-lockfile",
            clusterSize: 3,
            topTaxonomy: "lockfile_issue",
            traceId: "trace-heal-1",
          },
          alternativeOptions: [
            { action: "manual-fix", feasibility: "low" },
            { action: "rollback-contract", feasibility: "medium" },
          ],
          outcomeDetail: { result: "unknown" },
        },
        path
      );

      expect(record.schemaVersion).toBe(2);
      expect(record.rationale.fullReasoning).toContain("regenerate-bun-lockfile");
      expect(record.alternatives[0]?.feasibility).toBe("low");

      const raw = readText(path).trim();
      const parsed = JSON.parse(raw) as {
        schemaVersion: number;
        rationale: { evidence: unknown[] };
      };
      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.rationale.evidence.length).toBeGreaterThan(0);

      const [loaded] = await readDecisionLedger(path);
      expect(loaded?.decisionId).toBe(record.decisionId);
      expect(loaded?.trigger.traceId).toBe("trace-heal-1");
    } finally {
      removePath(dir, { recursive: true, force: true });
    }
  });

  test("createDecisionRecord stays pure without writing", () => {
    const record = createDecisionRecord({
      key: "preview",
      action: "noop",
      trigger: "unit test",
      rationale: "Preview only.",
      outcome: "unknown",
    });
    expect(record.decisionId.startsWith("decision-")).toBe(true);
    expect(record.rationale.summary).toBe("Preview only.");
  });
});
