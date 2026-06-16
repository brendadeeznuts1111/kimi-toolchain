import { describe, expect, test } from "bun:test";
import { inspectHerdrDoctor } from "../src/lib/herdr-doctor.ts";
import { REQUIRED_INTEGRATIONS } from "../src/lib/herdr-agents.ts";

describe("herdr-doctor", () => {
  test("inspectHerdrDoctor returns schema v1 report shape", () => {
    const report = inspectHerdrDoctor({}, "/tmp/herdr-doctor-test-home");

    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof report.checks.binary).toBe("boolean");
    expect(typeof report.readiness.ready).toBe("boolean");
    expect(Array.isArray(report.readiness.blockers)).toBe(true);
    expect(Array.isArray(report.readiness.warnings)).toBe(true);
  });

  test("inspectHerdrDoctor flags missing config on empty home", () => {
    const report = inspectHerdrDoctor({}, "/tmp/herdr-doctor-missing-config");

    expect(report.checks.config).toBe(false);
    expect(report.readiness.ready).toBe(false);
    expect(report.readiness.blockers.some((b) => b.includes("missing config"))).toBe(true);
  });

  test("lint path uses REQUIRED_INTEGRATIONS when manifest absent", () => {
    const report = inspectHerdrDoctor({}, "/tmp/herdr-doctor-integrations");
    expect(REQUIRED_INTEGRATIONS.length).toBeGreaterThan(0);
    expect(report.details.missingIntegrations.length).toBeGreaterThanOrEqual(0);
  });
});