import { describe, expect, test } from "bun:test";
import {
  formatRuntimeUtilsCoverageGate,
  runtimeUtilsCoverageGate,
  runtimeUtilsCoverageGateDefinition,
} from "../src/gates/runtime-utils-coverage.ts";

describe("runtime-utils-coverage-gate", () => {
  test("passes coverage threshold for kimi-toolchain inventory", async () => {
    const result = await runtimeUtilsCoverageGate(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.coveragePercent).toBeGreaterThanOrEqual(85);
    expect(result.wrapped).toBeGreaterThan(0);
    expect(formatRuntimeUtilsCoverageGate(result)[0]).toContain("pass: runtime-utils-coverage");
  });

  test("gate definition is registered with runner shape", () => {
    expect(runtimeUtilsCoverageGateDefinition.name).toBe("runtime-utils-coverage");
    expect(runtimeUtilsCoverageGateDefinition.parallel).toBe(true);
  });
});
