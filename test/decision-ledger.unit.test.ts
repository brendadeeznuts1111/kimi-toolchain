import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { explainDecision, recordDecision } from "../src/lib/decision-ledger.ts";

describe("decision-ledger", () => {
  test("records and explains a decision by topic", async () => {
    const dir = join(tmpdir(), `kimi-why-${Bun.randomUUIDv7()}`);
    const path = join(dir, "decision-ledger.jsonl");
    mkdirSync(dir, { recursive: true });
    try {
      const record = recordDecision(
        {
          key: "typecheck-strict",
          action: "enable strict typecheck",
          trigger: "recurring type drift in CI",
          reasoning: "Strict typecheck catches shared-contract breakage before runtime.",
          alternatives: ["run only oxlint", "skip typecheck on docs changes"],
          outcome: "typecheck remains a required source gate",
          traceId: "trace-1",
        },
        path
      );

      const explanation = await explainDecision("typecheck", path);

      expect(record.id.startsWith("decision-")).toBe(true);
      expect(explanation.matches).toHaveLength(1);
      expect(explanation.latest?.reasoning).toContain("shared-contract");
      expect(explanation.latest?.alternatives).toContain("run only oxlint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
