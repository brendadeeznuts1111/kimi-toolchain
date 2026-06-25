import { describe, expect, test } from "bun:test";
import {
  buildRuntimeUtilsCoverageReport,
  RUNTIME_UTILS_COVERAGE,
} from "../src/lib/bun-runtime-utils-coverage.ts";

describe("bun-runtime-utils-coverage", () => {
  test("includes Bun.openInEditor as native-only", () => {
    const entry = RUNTIME_UTILS_COVERAGE.find((e) => e.api === "Bun.openInEditor");
    expect(entry?.status).toBe("native-only");
    expect(entry?.docUrlConst).toBe("BUN_OPEN_IN_EDITOR_DOC_URL");
  });

  test("includes Bun.semver direct native usage", () => {
    const entry = RUNTIME_UTILS_COVERAGE.find((e) => e.api === "Bun.semver");
    expect(entry?.docUrlConst).toBe("BUN_SEMVER_DOC_URL");
    expect(entry?.status).toBe("native-only");
  });

  test("buildRuntimeUtilsCoverageReport computes coverage", () => {
    const report = buildRuntimeUtilsCoverageReport();
    expect(report.wrapped + report.nativeOnly).toBeGreaterThan(10);
    expect(report.coveragePercent).toBeGreaterThanOrEqual(85);
  });
});
