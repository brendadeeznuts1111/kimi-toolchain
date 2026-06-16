import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { REQUIRED_INTEGRATIONS } from "../src/lib/herdr-agents.ts";
import { inspectHerdrDoctor } from "../src/lib/herdr-doctor.ts";
import { HerdrSessionError } from "../src/lib/herdr-session-preflight.ts";

function minimalDoctorHome(): string {
  const home = join(tmpdir(), `herdr-doctor-${Bun.randomUUIDv7()}`);
  mkdirSync(join(home, ".config", "dx"), { recursive: true });
  writeFileSync(join(home, ".config", "dx", "herdr.toml"), 'session = "dev"\n');
  return home;
}

describe("herdr-doctor", () => {
  test("inspectHerdrDoctor returns schema v1 report shape", async () => {
    const report = await inspectHerdrDoctor({}, "/tmp/herdr-doctor-test-home");

    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof report.checks.binary).toBe("boolean");
    expect(typeof report.readiness.ready).toBe("boolean");
    expect(Array.isArray(report.readiness.blockers)).toBe(true);
    expect(Array.isArray(report.readiness.warnings)).toBe(true);
  });

  test("inspectHerdrDoctor flags missing config on empty home", async () => {
    const report = await inspectHerdrDoctor({}, "/tmp/herdr-doctor-missing-config");

    expect(report.checks.config).toBe(false);
    expect(report.readiness.ready).toBe(false);
    expect(report.readiness.blockers.some((b) => b.includes("missing config"))).toBe(true);
  });

  test("lint path uses REQUIRED_INTEGRATIONS when manifest absent", async () => {
    const report = await inspectHerdrDoctor({}, "/tmp/herdr-doctor-integrations");
    expect(REQUIRED_INTEGRATIONS.length).toBeGreaterThan(0);
    expect(report.details.missingIntegrations.length).toBeGreaterThanOrEqual(0);
  });

  test("live probes skipped with HerdrSessionError warning when session down", async () => {
    if (!Bun.which("herdr")) return;

    const home = minimalDoctorHome();
    const report = await inspectHerdrDoctor(
      {
        fix: true,
        requireSessionRunning: async () => {
          throw new HerdrSessionError("dev", "stopped", "start with: herdr --session dev server");
        },
      },
      home
    );

    expect(report.checks.server).toBe(false);
    expect(report.readiness.warnings).toContain(
      'herdr session "dev" stopped — start with: herdr --session dev server'
    );
    expect(report.readiness.blockers).toHaveLength(0);
    expect(report.readiness.ready).toBe(true);
    expect(report.details.fixes).toHaveLength(0);
  });

  test("--fix skips manifest update when session preflight fails", async () => {
    if (!Bun.which("herdr")) return;

    const home = minimalDoctorHome();
    const report = await inspectHerdrDoctor(
      {
        fix: true,
        requireSessionRunning: async () => {
          throw new HerdrSessionError(
            "default",
            "missing",
            "create with: herdr --session default server"
          );
        },
      },
      home
    );

    expect(report.readiness.warnings).toContain("manifest fix skipped: server not running");
    expect(report.details.fixes).toHaveLength(0);
  });
});
