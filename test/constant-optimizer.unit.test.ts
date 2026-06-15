import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DECISION_SCHEMA_VERSION, type Decision } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import {
  buildConstantOptimizerReport,
  collectConstantRepairEvents,
  applyConfidenceDecay,
  computeBaseRecommendation,
  INSUFFICIENT_DATA_BASE_CONFIDENCE,
  INSUFFICIENT_DATA_FLOOR_CONFIDENCE,
} from "../src/lib/constant-optimizer.ts";

describe("constant-optimizer", () => {
  let projectDir: string;
  let failurePath: string;
  const repairTime = "2026-06-15T10:00:00.000Z";

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      mkdirSync(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  it("should collect constant-repair events from decisions", () => {
    const decisions: Decision[] = [
      {
        schemaVersion: 2,
        decisionId: "dec-repair-1",
        timestamp: repairTime,
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-1" },
        rationale: { summary: "repair", fullReasoning: "repair", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-repair",
          restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"],
        },
      },
    ];

    const events = collectConstantRepairEvents(decisions);
    expect(events).toHaveLength(1);
    expect(events[0]?.restoredKeys).toEqual(["KIMI_HOOK_VERIFIER_MAX_CYCLES"]);
  });

  it("should correlate bound constant repairs with taxonomy failure deltas", async () => {
    projectDir = join(tmpdir(), `constant-optimizer-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");

    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lockfile_issue
    name: Lockfile integrity issue
    description: lockfile hash mismatch
    severity: error
    expected: false
    boundConstants:
      - KIMI_HOOK_VERIFIER_MAX_CYCLES
    patterns:
      - regex: "HASH MISMATCH"
`,
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "500"
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 500
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    mkdirSync(join(projectDir, ".kimi"), { recursive: true });
    writeFileSync(
      decisionsNdjsonPath(projectDir),
      `${JSON.stringify({
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-opt-1",
        timestamp: repairTime,
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-opt" },
        rationale: { summary: "repair", fullReasoning: "repair", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-repair",
          goldenVersion: "1.0.0",
          restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"],
        },
      })}\n`
    );

    writeFileSync(
      failurePath,
      [
        JSON.stringify({
          errorId: "err-before-1",
          taxonomyId: "lockfile_issue",
          timestamp: "2026-06-15T08:00:00.000Z",
          output: "HASH MISMATCH before",
          toolName: "kimi-guardian",
        }),
        JSON.stringify({
          errorId: "err-before-2",
          taxonomyId: "lockfile_issue",
          timestamp: "2026-06-15T09:00:00.000Z",
          output: "HASH MISMATCH before 2",
          toolName: "kimi-guardian",
        }),
        JSON.stringify({
          errorId: "err-after-1",
          taxonomyId: "lockfile_issue",
          timestamp: "2026-06-15T11:00:00.000Z",
          output: "HASH MISMATCH after",
          toolName: "kimi-guardian",
        }),
      ].join("\n") + "\n"
    );

    const report = await buildConstantOptimizerReport(projectDir, {
      failurePath,
      windowMs: 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-06-16T10:00:00.000Z"),
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.constantKey).toBe("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    expect(report.entries[0]?.taxonomyOutcomes[0]).toMatchObject({
      taxonomyId: "lockfile_issue",
      beforeCount: 2,
      afterCount: 1,
      delta: -1,
    });
    expect(report.entries[0]?.recommendation).toBe("promote");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should decay insufficient-data confidence over time", () => {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const base = computeBaseRecommendation([], 0, 0);
    expect(base.recommendation).toBe("insufficient-data");

    const atThirtyDays = applyConfidenceDecay({
      recommendation: "insufficient-data",
      baseConfidence: INSUFFICIENT_DATA_BASE_CONFIDENCE,
      repairAgeMs: 30 * MS_DAY,
      afterTotal: 0,
    });
    expect(atThirtyDays).toBeCloseTo(INSUFFICIENT_DATA_FLOOR_CONFIDENCE, 2);
  });

  it("should preserve confidence when post-repair outcomes exist", () => {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const confidence = applyConfidenceDecay({
      recommendation: "review",
      baseConfidence: 0.65,
      repairAgeMs: 45 * MS_DAY,
      afterTotal: 3,
    });
    expect(confidence).toBe(0.65);
  });
});
