import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DECISION_SCHEMA_VERSION } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import {
  applyConfidenceDecayWithBreakdown,
  buildOptimizerApplyPlan,
  formatConfidenceBreakdownLine,
  formatOptimizerDoctorDetailLines,
  formatOptimizerDoctorHealthMessage,
  formatOptimizerApplyResultLines,
  optimizerRecommendationsToJson,
  printConstantOptimizerRecommendationsBlock,
  generateOptimizerDoctorRecommendations,
  buildOptimizerDoctorMachineChecks,
  optimizerRecommendationToMachineCheck,
  rewriteOptimizerDefineValues,
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

  test("pure formatter and JSON recommendation expose operator review details", () => {
    const lines: string[] = [];
    const fakeLogger = {
      section: (title: string) => lines.push(`── ${title} ──`),
      line: (line: string) => lines.push(line),
    };
    const confidenceBreakdown = applyConfidenceDecayWithBreakdown({
      recommendation: "review",
      baseConfidence: 0.7,
      repairAgeMs: 0,
      afterTotal: 1,
    });
    const recommendations = [
      {
        constant: constantKey,
        currentValue: 600,
        goldenValue: 500,
        boundTaxonomies: ["lockfile_issue"],
        driftPct: 20,
        confidence: 0.7,
        confidenceBreakdown,
        baseConfidence: 0.7,
        basedOnDecisionIds: ["dec-repair-0042"],
        outcomeCount: 3,
        activeFailureCount: 2,
        resolvedFailureCount: 1,
        lastReviewMs: 0,
        clusterFailureRateDelta: -50,
        optimizerAction: "review" as const,
        severity: "warn" as const,
        action: "kimi-heal repair-constants --dry-run",
        message: "review suggested",
      },
    ];

    printConstantOptimizerRecommendationsBlock(
      fakeLogger as unknown as Parameters<typeof printConstantOptimizerRecommendationsBlock>[0],
      recommendations
    );

    expect(lines.join("\n")).toContain("── Constant Optimizer ──");
    expect(lines.join("\n")).toContain("• KIMI_HOOK_VERIFIER_MAX_CYCLES: 600 → 500");
    expect(lines.join("\n")).toContain("Resolves 1 of 2 active failures in taxonomy");
    expect(lines.join("\n")).toContain("Confidence detail: base 0.70 → final 0.70");
    expect(lines.join("\n")).toContain("Review with: kimi-heal repair-constants --dry-run");
    expect(formatConfidenceBreakdownLine(confidenceBreakdown)).toContain(
      "after failures 1; no decay, no floor"
    );
    expect(formatOptimizerDoctorHealthMessage(recommendations)).toBe(
      "Optimizer: KIMI_HOOK_VERIFIER_MAX_CYCLES 600 -> 500 would resolve 1 lockfile_issue error (confidence 0.70)"
    );
    expect(optimizerRecommendationsToJson(recommendations)[0]).toMatchObject({
      constant: constantKey,
      currentValue: 600,
      recommendedValue: 500,
      resolvedFailureCount: 1,
      activeFailureCount: 2,
      reason: "Would resolve 1 lockfile_issue error in the last 7 days",
      confidence: 0.7,
      confidenceBreakdown,
      reviewCommand: "kimi-heal repair-constants --dry-run",
    });
  });

  test("pure apply plan gates recommendations by requested constants and confidence", () => {
    const highConfidence = applyConfidenceDecayWithBreakdown({
      recommendation: "review",
      baseConfidence: 0.82,
      repairAgeMs: 0,
      afterTotal: 2,
    });
    const lowConfidence = applyConfidenceDecayWithBreakdown({
      recommendation: "hold",
      baseConfidence: 0.4,
      repairAgeMs: 0,
      afterTotal: 2,
    });
    const recommendations = [
      {
        constant: constantKey,
        currentValue: 600,
        goldenValue: 500,
        boundTaxonomies: ["lockfile_issue"],
        driftPct: 20,
        confidence: 0.82,
        confidenceBreakdown: highConfidence,
        baseConfidence: 0.82,
        basedOnDecisionIds: ["dec-repair-0042"],
        outcomeCount: 4,
        activeFailureCount: 3,
        resolvedFailureCount: 1,
        lastReviewMs: 0,
        clusterFailureRateDelta: -33,
        optimizerAction: "review" as const,
        severity: "warn" as const,
        action: "kimi-heal repair-constants --dry-run",
        message: "review suggested",
      },
      {
        constant: "KIMI_NETWORK_TIMEOUT_MS",
        currentValue: 3000,
        goldenValue: 5000,
        boundTaxonomies: ["network_timeout"],
        driftPct: 40,
        confidence: 0.4,
        confidenceBreakdown: lowConfidence,
        baseConfidence: 0.4,
        basedOnDecisionIds: ["dec-repair-0099"],
        outcomeCount: 4,
        activeFailureCount: 2,
        resolvedFailureCount: 0,
        lastReviewMs: 0,
        clusterFailureRateDelta: 0,
        optimizerAction: "hold" as const,
        severity: "warn" as const,
        action: "kimi-heal constants optimize --json",
        message: "hold suggested",
      },
    ];

    const plan = buildOptimizerApplyPlan(
      recommendations,
      [constantKey, "KIMI_NETWORK_TIMEOUT_MS", "KIMI_MISSING"],
      0.7
    );

    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0]?.constant).toBe(constantKey);
    expect(plan.selected[0]?.proposedValue).toBe(500);
    expect(plan.skipped.map((item) => item.constant)).toContain("KIMI_NETWORK_TIMEOUT_MS");
    expect(plan.skipped.map((item) => item.constant)).toContain("KIMI_MISSING");
    expect(
      plan.skipped.find((item) => item.constant === "KIMI_NETWORK_TIMEOUT_MS")?.skipReason
    ).toContain("below threshold");

    const rewritten = rewriteOptimizerDefineValues(
      `[define]\n${constantKey} = 600 # keep me\nKIMI_NETWORK_TIMEOUT_MS = 3000\n`,
      plan.selected
    );
    expect(rewritten.appliedKeys).toEqual([constantKey]);
    expect(rewritten.missingKeys).toEqual([]);
    expect(rewritten.text).toContain(`${constantKey} = 500 # keep me`);

    const lines = formatOptimizerApplyResultLines({
      ...plan,
      applied: false,
      dryRun: true,
      bunfigPath: "/tmp/demo/bunfig.toml",
      decisionIds: [],
      rewrittenBunfig: rewritten.text,
      detail: "dry-run",
    });
    expect(lines.join("\n")).toContain("Would apply KIMI_HOOK_VERIFIER_MAX_CYCLES: 600 → 500");
    expect(lines.join("\n")).toContain("Dry run — pass --yes to write bunfig.toml");
  });
});
