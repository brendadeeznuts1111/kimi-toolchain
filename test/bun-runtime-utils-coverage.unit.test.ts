import { describe, expect, test } from "bun:test";
import {
  buildRuntimeUtilsCoverageReport,
  RUNTIME_UTILS_COVERAGE,
} from "../src/lib/bun-runtime-utils-coverage.ts";

describe("bun-runtime-utils-coverage", () => {
  test("includes Bun.openInEditor wrapper", () => {
    const entry = RUNTIME_UTILS_COVERAGE.find((e) => e.api === "Bun.openInEditor");
    expect(entry?.wrapper).toBe("openFileInEditor");
    expect(entry?.status).toBe("wrapped");
  });

  test("includes Bun.semver wrapper", () => {
    const entry = RUNTIME_UTILS_COVERAGE.find((e) => e.api === "Bun.semver");
    expect(entry?.module).toBe("src/lib/version.ts");
    expect(entry?.status).toBe("wrapped");
  });

  test("buildRuntimeUtilsCoverageReport computes coverage", () => {
    const report = buildRuntimeUtilsCoverageReport();
    expect(report.wrapped).toBeGreaterThan(10);
    expect(report.coveragePercent).toBeGreaterThan(50);
  });
});
