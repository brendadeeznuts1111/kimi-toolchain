import { describe, expect, test } from "bun:test";
import { aggregateChecks, buildDoctorReport, statusIcon } from "../src/lib/health-check.ts";

describe("health-check", () => {
  test("aggregateChecks computes derived counts", () => {
    const report = aggregateChecks("test-tool", [
      { name: "a", status: "ok", message: "fine", fixable: false },
      { name: "b", status: "warn", message: "hmm", fixable: true },
      { name: "c", status: "error", message: "bad", fixable: false },
    ]);
    expect(report.tool).toBe("test-tool");
    expect(report.errorCount).toBe(1);
    expect(report.warnCount).toBe(1);
    expect(report.fixableCount).toBe(1);
  });

  test("buildDoctorReport is backward-compatible alias", () => {
    const report = buildDoctorReport("legacy", []);
    expect(report.checks).toEqual([]);
  });

  test("statusIcon returns icons", () => {
    expect(statusIcon("ok")).toBe("✓");
    expect(statusIcon("error")).toBe("✗");
  });
});
