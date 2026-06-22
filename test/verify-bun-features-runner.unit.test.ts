import { describe, expect, test } from "bun:test";
import {
  countVerifyFailures,
  runVerifyBunFeatures,
  VERIFY_GROUP_ORDER,
  type VerifyReport,
} from "../src/lib/verify-bun-features-runner.ts";

describe("verify-bun-features-runner", () => {
  test("runVerifyBunFeatures returns grouped checks and summary", async () => {
    const report = await runVerifyBunFeatures();
    expect(report.checks.length).toBeGreaterThan(10);
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.summary.bunVersion).toBe(Bun.version);
    for (const group of VERIFY_GROUP_ORDER) {
      if (group === "profile") continue;
      expect(report.checks.some((c) => c.group === group)).toBe(true);
    }
    const templatePolicy = report.checks.find((c) => c.id === "templates.policy");
    expect(templatePolicy?.ok).toBe(true);
    const templateRegistry = report.checks.find((c) => c.id === "templates.registry");
    expect(templateRegistry?.ok).toBe(true);
    expect(report.checks.every((c) => c.ms >= 0)).toBe(true);
  }, 60_000);

  test("countVerifyFailures ignores advisory drift unless strict", async () => {
    const advisoryReport = {
      checks: [
        { id: "a", group: "audit" as const, ok: true, ms: 1, detail: "ok", advisory: true },
        { id: "b", group: "audit" as const, ok: false, ms: 1, detail: "fail", advisory: true },
        { id: "c", group: "runtime" as const, ok: false, ms: 1, detail: "fail" },
      ],
      configReport: null,
      summary: {
        total: 3,
        passed: 1,
        failed: 2,
        advisory: 1,
        configAligned: false,
        durationMs: 10,
        bunVersion: Bun.version,
      },
      metadata: {
        schemaVersion: 1,
        generatedAt: new Date(0).toISOString(),
        projectRoot: ".",
        bunVersion: Bun.version,
        endpointCatalog: {
          schemaVersion: 1,
          cli: 0,
          http: { curated: 0, dashboard: 0 },
          total: 0,
          layers: {
            secrets: 0,
            config: 0,
            network: 0,
            images: 0,
            bundle: 0,
            verify: 0,
            doctor: 0,
            identity: 0,
            runtime: 0,
            templates: 0,
          },
        },
      },
      endpoints: {
        catalog: { cli: [], http: { curated: [], dashboard: [] }, all: [] },
        probes: [],
      },
    } satisfies VerifyReport;
    expect(countVerifyFailures(advisoryReport, false)).toBe(1);
    expect(countVerifyFailures(advisoryReport, true)).toBe(2);
  });

  test("runVerifyBunFeatures includes endpoint catalog and probes", async () => {
    const report = await runVerifyBunFeatures();
    expect(report.metadata.endpointCatalog.cli).toBeGreaterThan(10);
    expect(report.metadata.endpointCatalog.http.dashboard).toBeGreaterThan(50);
    expect(report.endpoints.catalog.cli.length).toBe(report.metadata.endpointCatalog.cli);
    expect(report.endpoints.probes.length).toBeGreaterThan(5);
    expect(report.checks.some((c) => c.id === "audit.bundle.dry-run")).toBe(true);
  }, 60_000);
});
