import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DECISION_SCHEMA_VERSION, type Decision } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import {
  buildConstantOptimizerReport,
  collectConstantRepairEvents,
  generateOptimizerDoctorRecommendations,
} from "../src/lib/constant-optimizer.ts";
import { GOLDEN_SCHEMA_VERSION } from "../src/lib/constants-heal.ts";
import { constantsGoldenPath } from "../src/lib/paths.ts";

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
});

describe("optimizer-doctor", () => {
  let projectDir: string;
  let failurePath: string;
  const repairTime = "2026-06-15T10:00:00.000Z";
  const windowMs = 24 * 60 * 60 * 1000;
  const nowMs = Date.parse("2026-06-16T10:00:00.000Z");

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      mkdirSync(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  function writeBaseProject(bunfigValue: string): void {
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
KIMI_HOOK_VERIFIER_MAX_CYCLES = "${bunfigValue}"
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

    mkdirSync(join(projectDir, ".kimi", "var"), { recursive: true });
    writeFileSync(
      decisionsNdjsonPath(projectDir),
      `${JSON.stringify({
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-opt-doctor",
        timestamp: repairTime,
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-opt-doctor" },
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
  }

  function writeGolden(value: number): void {
    writeFileSync(
      constantsGoldenPath(projectDir),
      `${JSON.stringify({
        schemaVersion: GOLDEN_SCHEMA_VERSION,
        tuningSetVersion: "0.0.0",
        capturedAt: repairTime,
        constants: {
          KIMI_HOOK_VERIFIER_MAX_CYCLES: {
            defineDomain: "hook-verifier",
            rawValue: `"${value}"`,
            value,
          },
        },
      })}\n`
    );
  }

  function writeFailures(before: number, after: number, worsened = false): void {
    const lines: string[] = [];
    for (let i = 0; i < before; i++) {
      lines.push(
        JSON.stringify({
          errorId: `err-before-${i}`,
          taxonomyId: "lockfile_issue",
          timestamp: "2026-06-15T08:00:00.000Z",
          output: "HASH MISMATCH before",
          toolName: "kimi-guardian",
        })
      );
    }
    const afterCount = worsened ? before + after : after;
    for (let i = 0; i < afterCount; i++) {
      lines.push(
        JSON.stringify({
          errorId: `err-after-${i}`,
          taxonomyId: "lockfile_issue",
          timestamp: "2026-06-15T11:00:00.000Z",
          output: "HASH MISMATCH after",
          toolName: "kimi-guardian",
        })
      );
    }
    writeFileSync(failurePath, `${lines.join("\n")}\n`);
  }

  it("should emit info when promote and golden matches current", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-info-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("500");
    writeGolden(500);
    writeFailures(2, 1);

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("info");
    expect(recommendations[0]?.optimizerAction).toBe("promote");
    expect(recommendations[0]?.driftPct).toBe(0);
    expect(recommendations[0]?.action).toBe("kimi-heal constants optimize --json");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should emit warn when failures worsen after repair", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-warn-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("500");
    writeGolden(500);
    writeFailures(1, 2, true);

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("warn");
    expect(recommendations[0]?.optimizerAction).toBe("review");
    expect(recommendations[0]?.message).toContain("failures after repair");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should emit error when golden drift is critical and failures regress", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-error-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("1000");
    writeGolden(500);
    writeFailures(1, 2, true);

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("error");
    expect(recommendations[0]?.driftPct).toBe(100);
    expect(recommendations[0]?.action).toBe("kimi-heal repair-constants --dry-run");
    expect(recommendations[0]?.message).toContain("golden drift");

    rmSync(projectDir, { recursive: true, force: true });
  });
});
