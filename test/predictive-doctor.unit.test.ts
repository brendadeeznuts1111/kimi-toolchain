import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  appendHealthSnapshot,
  computeDecisionVelocity,
  computeHealthScore,
  correlateHealthWithConstants,
  detectAnomalies,
  parsePredictiveWindow,
  predictThresholdBreach,
  readHealthSnapshots,
  type HealthSnapshot,
} from "../src/lib/predictive-doctor.ts";
import { healthSnapshotsPath } from "../src/lib/paths.ts";
import type { Decision } from "../src/lib/decision-ledger.ts";

describe("predictive-doctor", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `predictive-doctor-${Bun.randomUUIDv7()}`);
    mkdirSync(join(projectDir, ".kimi", "var"), { recursive: true });
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function snapshot(
    timestamp: string,
    score: number,
    status: "ok" | "warn" | "error" = "ok"
  ): HealthSnapshot {
    const error = status === "error" ? 1 : 0;
    const warn = status === "warn" ? 1 : 0;
    const ok = status === "ok" ? 1 : 0;
    return {
      schemaVersion: 1,
      timestamp,
      project: "demo",
      score,
      checks: [{ name: "constant-optimizer", status, fixable: false }],
      summary: { total: 1, ok, warn, error, fixable: 0 },
      decisionVelocity: 0,
      activeDriftCount: status === "ok" ? 0 : 1,
    };
  }

  function decision(id: string, timestamp: string, type = "constant-repair"): Decision {
    return {
      schemaVersion: 2,
      decisionId: id,
      timestamp,
      actor: "kimi",
      action: "config-change",
      trigger: { traceId: `trace-${id}` },
      rationale: {
        summary: "constant changed",
        fullReasoning: "test decision",
        evidence: [],
      },
      alternatives: [],
      outcome: { result: "success" },
      metadata: {
        type,
        restoredKeys: ["KIMI_TIMEOUT_MS"],
      },
    };
  }

  test("computes bounded health scores from warning and error counts", () => {
    expect(computeHealthScore({ total: 3, warn: 1, error: 1 })).toBe(75);
    expect(computeHealthScore({ total: 0, warn: 0, error: 0 })).toBe(100);
    expect(computeHealthScore({ total: 10, warn: 0, error: 10 })).toBe(0);
  });

  test("parses predictive windows", () => {
    expect(parsePredictiveWindow("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parsePredictiveWindow("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parsePredictiveWindow("30m")).toBe(30 * 60 * 1000);
    expect(() => parsePredictiveWindow("soon")).toThrow("Invalid window");
  });

  test("appends, dedupes, and reads health snapshots with malformed-line tolerance", async () => {
    const first = await appendHealthSnapshot(projectDir, {
      nowMs: Date.parse("2026-06-15T10:00:00.000Z"),
      checks: [{ name: "bun", status: "ok" }],
      gitHead: "abc123",
    });
    expect(first?.score).toBe(100);

    const duplicate = await appendHealthSnapshot(projectDir, {
      nowMs: Date.parse("2026-06-15T10:30:00.000Z"),
      checks: [{ name: "bun", status: "ok" }],
      gitHead: "abc123",
    });
    expect(duplicate).toBeNull();

    const path = healthSnapshotsPath(projectDir);
    await Bun.write(path, `${await Bun.file(path).text()}not-json\n`);
    const records = await readHealthSnapshots(projectDir, {
      nowMs: Date.parse("2026-06-15T11:00:00.000Z"),
      windowMs: 24 * 60 * 60 * 1000,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.gitHead).toBe("abc123");
  });

  test("detects score and check anomalies against a stable baseline", () => {
    const history = [
      snapshot("2026-06-15T10:00:00.000Z", 100),
      snapshot("2026-06-15T11:00:00.000Z", 100),
      snapshot("2026-06-15T12:00:00.000Z", 100),
      snapshot("2026-06-15T13:00:00.000Z", 60, "error"),
    ];
    const anomalies = detectAnomalies(history, 24 * 60 * 60 * 1000);
    expect(anomalies.map((item) => item.kind)).toContain("score");
    expect(anomalies.map((item) => item.kind)).toContain("check");
  });

  test("computes decision velocity against a previous baseline window", () => {
    const nowMs = Date.parse("2026-06-15T12:00:00.000Z");
    const report = computeDecisionVelocity(
      [
        decision("dec-1", "2026-06-15T11:00:00.000Z"),
        decision("dec-2", "2026-06-15T10:00:00.000Z"),
        decision("dec-3", "2026-06-14T11:00:00.000Z"),
      ],
      4 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      { nowMs }
    );
    expect(report.currentCount).toBe(2);
    expect(report.baselineCount).toBe(1);
    expect(report.currentPerHour).toBe(0.5);
  });

  test("predicts threshold breaches and handles insufficient data", () => {
    expect(predictThresholdBreach([snapshot("2026-06-15T10:00:00.000Z", 100)]).status).toBe(
      "insufficient-data"
    );

    const prediction = predictThresholdBreach(
      [
        snapshot("2026-06-15T10:00:00.000Z", 100),
        snapshot("2026-06-15T11:00:00.000Z", 92),
        snapshot("2026-06-15T12:00:00.000Z", 84),
      ],
      { horizonHours: 1, threshold: 80 }
    );
    expect(prediction.status).toBe("predicted");
  });

  test("correlates health drops with constant decisions", () => {
    const correlations = correlateHealthWithConstants(
      [snapshot("2026-06-15T10:00:00.000Z", 100), snapshot("2026-06-15T11:00:00.000Z", 88)],
      [decision("dec-constant", "2026-06-15T10:30:00.000Z")]
    );
    expect(correlations).toHaveLength(1);
    expect(correlations[0]?.decisions[0]?.decisionId).toBe("dec-constant");
  });
});
