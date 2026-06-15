import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DECISION_SCHEMA_VERSION } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import {
  formatOptimizerDoctorDetailLines,
  generateOptimizerDoctorRecommendations,
  buildOptimizerDoctorMachineChecks,
  optimizerRecommendationToMachineCheck,
} from "../src/lib/constant-optimizer.ts";
import { GOLDEN_SCHEMA_VERSION } from "../src/lib/constants-heal.ts";
import { constantsGoldenPath } from "../src/lib/paths.ts";

describe("optimizer-doctor", () => {
  let projectDir: string;
  let failurePath: string;
  const repairTime = "2026-06-15T10:00:00.000Z";
  const windowMs = 24 * 60 * 60 * 1000;
  const nowMs = Date.parse("2026-06-16T10:00:00.000Z");
  const constantKey = "KIMI_HOOK_VERIFIER_MAX_CYCLES";

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
      - ${constantKey}
    patterns:
      - regex: "HASH MISMATCH"
`,
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
${constantKey} = "${bunfigValue}"
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 500
 */
declare const ${constantKey}: number;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });
    mkdirSync(join(projectDir, ".kimi", "var"), { recursive: true });
  }

  function writeGolden(value: number): void {
    writeFileSync(
      constantsGoldenPath(projectDir),
      `${JSON.stringify({
        schemaVersion: GOLDEN_SCHEMA_VERSION,
        tuningSetVersion: "0.0.0",
        capturedAt: repairTime,
        constants: {
          [constantKey]: {
            defineDomain: "hook-verifier",
            rawValue: `"${value}"`,
            value,
          },
        },
      })}\n`
    );
  }

  function writeDecisions(extraDecisions: Array<Record<string, unknown>> = []): void {
    const repairDecision = {
      schemaVersion: DECISION_SCHEMA_VERSION,
      decisionId: "dec-repair-0042",
      timestamp: repairTime,
      actor: "kimi",
      action: "config-change",
      trigger: { traceId: "trace-repair" },
      rationale: { summary: "repair", fullReasoning: "repair", evidence: [] },
      alternatives: [],
      outcome: { result: "success" },
      metadata: {
        type: "constant-repair",
        goldenVersion: "1.0.0",
        restoredKeys: [constantKey],
      },
    };
    const lines = [repairDecision, ...extraDecisions].map((item) => JSON.stringify(item));
    writeFileSync(decisionsNdjsonPath(projectDir), `${lines.join("\n")}\n`);
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

  test("optimizer surfaces info when candidate exists but no drift", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-info-candidate-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("500");
    writeGolden(500);
    writeFailures(2, 1);
    writeDecisions([
      {
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-opt-0042",
        timestamp: "2026-06-15T10:05:00.000Z",
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-opt" },
        rationale: { summary: "optimize", fullReasoning: "optimize", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-optimization",
          constantKey,
          candidateValue: 450,
        },
      },
    ]);

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("info");
    expect(recommendations[0]?.driftPct).toBe(0);
    expect(recommendations[0]?.candidateValue).toBe(450);
    expect(recommendations[0]?.action).toBe("kimi-heal constants optimize --review candidate-0042");

    const detail = formatOptimizerDoctorDetailLines(recommendations[0]!);
    expect(detail.join("\n")).toContain("Candidate: 450");

    rmSync(projectDir, { recursive: true, force: true });
  });

  test("optimizer surfaces warn when drift + high confidence", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-warn-drift-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("600");
    writeGolden(500);
    writeFailures(2, 1);
    writeDecisions();

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("warn");
    expect(recommendations[0]?.driftPct).toBe(20);
    expect(recommendations[0]?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(recommendations[0]?.message).toContain("golden drift 20%");

    const detail = formatOptimizerDoctorDetailLines(recommendations[0]!);
    expect(detail.join("\n")).toContain("Drift: +20%");

    rmSync(projectDir, { recursive: true, force: true });
  });

  test("optimizer surfaces error when critical drift + failure rate up", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-error-rollback-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("1000");
    writeGolden(500);
    writeFailures(1, 2, true);
    writeDecisions();

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.severity).toBe("error");
    expect(recommendations[0]?.clusterFailureRateDelta).toBeGreaterThan(0);
    expect(recommendations[0]?.message).toContain("auto-rollback review suggested");
    expect(recommendations[0]?.action).toBe("kimi-heal repair-constants --dry-run");

    const detail = formatOptimizerDoctorDetailLines(recommendations[0]!);
    expect(detail.join("\n")).toContain("Drift: +100%");
    expect(detail.join("\n")).toContain("repair-constants --dry-run");

    rmSync(projectDir, { recursive: true, force: true });
  });

  test("machine checks expose structured optimizer metadata", async () => {
    projectDir = join(tmpdir(), `optimizer-doctor-machine-${Date.now()}`);
    failurePath = join(projectDir, "failures.jsonl");
    writeBaseProject("1000");
    writeGolden(500);
    writeFailures(1, 2, true);
    writeDecisions();

    const checks = await buildOptimizerDoctorMachineChecks(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]?.source).toBe("constant-optimizer");
    expect(checks[0]?.name).toBe(`constant-optimizer:${constantKey}`);
    expect(checks[0]?.severity).toBe("error");
    expect(checks[0]?.confidence).toBeGreaterThan(0);
    expect(checks[0]?.driftPercent).toBe(100);
    expect(checks[0]?.decisionIds).toContain("dec-repair-0042");
    expect(checks[0]?.action).toBe("kimi-heal repair-constants --dry-run");

    const recommendations = await generateOptimizerDoctorRecommendations(projectDir, {
      failurePath,
      windowMs,
      nowMs,
    });
    const machine = optimizerRecommendationToMachineCheck(recommendations[0]!);
    expect(machine.constant).toBe(constantKey);

    rmSync(projectDir, { recursive: true, force: true });
  });
});
