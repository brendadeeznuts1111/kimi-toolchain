import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  appendOptimizerHealthTrend,
  readOptimizerHealthTrend,
} from "../src/lib/optimizer-health-trend.ts";
import type { OptimizerDoctorMachineCheck } from "../src/lib/constant-optimizer.ts";
import { optimizerHealthTrendPath } from "../src/lib/paths.ts";

describe("optimizer-health-trend", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = testTempDir("optimizer-trend-");
    makeDir(join(projectDir, ".kimi", "var"), { recursive: true });
    writeText(join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
  });

  afterEach(() => {
    removePath(projectDir, { recursive: true, force: true });
  });

  const warnCheck: OptimizerDoctorMachineCheck = {
    name: "constant-optimizer:KIMI_HOOK_VERIFIER_MAX_CYCLES",
    status: "warn",
    source: "constant-optimizer",
    severity: "warn",
    confidence: 0.2,
    baseConfidence: 0.2,
    driftPercent: 100,
    action: "kimi-heal repair-constants --dry-run",
    decisionIds: ["dec-test"],
    constant: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
    message: "drift detected",
  };

  it("should append actionable optimizer checks to ndjson ledger", async () => {
    const record = await appendOptimizerHealthTrend(projectDir, [warnCheck], {
      windowMs: 86_400_000,
      nowMs: Date.parse("2026-06-15T12:00:00.000Z"),
    });
    expect(record).not.toBeNull();
    expect(record?.summary.warnCount).toBe(1);

    const path = optimizerHealthTrendPath(projectDir);
    const text = await Bun.file(path).text();
    expect(text.trim().length).toBeGreaterThan(0);

    const records = await readOptimizerHealthTrend(projectDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.checks[0]?.constant).toBe("KIMI_HOOK_VERIFIER_MAX_CYCLES");
  });

  it("should skip append for summary-only checks", async () => {
    const record = await appendOptimizerHealthTrend(projectDir, [
      {
        name: "constant-optimizer:summary",
        status: "ok",
        source: "constant-optimizer",
        severity: "info",
        confidence: 0,
        driftPercent: null,
        action: "",
        decisionIds: [],
        constant: "summary",
        message: "no optimizer recommendations",
      },
    ]);
    expect(record).toBeNull();
    expect(await readOptimizerHealthTrend(projectDir)).toHaveLength(0);
  });
});
