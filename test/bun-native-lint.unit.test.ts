import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
  buildBaselineFromViolations,
  defaultConfig,
  evaluateViolations,
  mergeConfig,
  shouldFailCheck,
  violationKey,
  type Violation,
} from "../src/lib/bun-native-lint.ts";

function v(ruleId: string, file: string, line: number): Violation {
  return {
    ruleId,
    file,
    line,
    message: "test",
    snippet: "x",
    replacement: "y",
  };
}

describe("bun-native-lint", () => {
  test("enforce rules fail even when baselined", () => {
    const config = mergeConfig({
      rules: { "process-env": "enforce", "banned-import": "report" },
    });
    const violations = [v("process-env", "src/lib/a.ts", 1)];
    const baseline = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "process-env", file: "src/lib/a.ts", line: 1, snippet: "x" }],
    };
    const result = evaluateViolations(violations, config, baseline);
    expect(result.enforceViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(true);
  });

  test("report rules allow baselined violations", () => {
    const config = defaultConfig();
    const violations = [v("process-env", "src/lib/a.ts", 2)];
    const baseline = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "process-env", file: "src/lib/a.ts", line: 2, snippet: "x" }],
    };
    const result = evaluateViolations(violations, config, baseline);
    expect(result.newViolations).toHaveLength(0);
    expect(result.baselinedViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(false);
  });

  test("report rules fail on new violations", () => {
    const config = defaultConfig();
    const violations = [v("process-env", "src/lib/new.ts", 9)];
    const result = evaluateViolations(violations, config, null);
    expect(result.newViolations).toHaveLength(1);
    expect(shouldFailCheck(result, config, "check")).toBe(true);
  });

  test("update baseline for one rule preserves other entries", () => {
    const config = defaultConfig();
    const existing = {
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ ruleId: "banned-import", file: "src/lib/old.ts", line: 3, snippet: "import fs" }],
    };
    const next = buildBaselineFromViolations(
      [v("process-env", "src/lib/a.ts", 1)],
      config,
      existing,
      "process-env"
    );
    expect(next.entries).toHaveLength(2);
    expect(next.entries.some((e) => e.ruleId === "banned-import")).toBe(true);
    expect(next.entries.some((e) => e.ruleId === "process-env")).toBe(true);
  });

  test("violationKey is stable", () => {
    expect(violationKey(v("process-env", "src/lib/a.ts", 4))).toBe("process-env::src/lib/a.ts::4");
  });

  test("engine source is not self-flagged for process-env", async () => {
    const { scanFile, mergeConfig } = await import("../src/lib/bun-native-lint.ts");
    const rel = "src/lib/bun-native-lint.ts";
    const config = mergeConfig({
      rules: {
        "banned-import": "off",
        "banned-require": "off",
        "stringify-stdout": "off",
        "process-env": "enforce",
      },
    });
    const violations = await scanFile(join(import.meta.dir, ".."), rel, config);
    expect(violations.some((v) => v.file === rel)).toBe(false);
  });
});
