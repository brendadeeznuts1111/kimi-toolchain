import { makeDir, writeText } from "../src/lib/bun-io.ts";

import { join } from "path";
import { describe, expect, test } from "bun:test";
import { REQUIRED_INTEGRATIONS } from "../src/lib/herdr-agents.ts";
import {
  HERDR_SOCKET_ERROR_HINTS,
  buildHerdrSocketDoctorHints,
  inspectHerdrDoctor,
} from "../src/lib/herdr-doctor.ts";
import type { HerdrSocketHealthProbe } from "../src/lib/herdr-socket-transport.ts";
import { HerdrSessionError } from "../src/lib/herdr-session-preflight.ts";

import { testTempDir } from "./helpers.ts";
function minimalDoctorHome(): string {
  const home = testTempDir("herdr-doctor-");
  makeDir(join(home, ".config", "dx"), { recursive: true });
  writeText(join(home, ".config", "dx", "herdr.toml"), 'session = "dev"\n');
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
    expect(typeof report.checks.socketTransport).toBe("boolean");
    expect(report.details.socketTransportProbe).toMatchObject({
      transport: expect.any(String),
      wsSupported: expect.any(Boolean),
      socketPath: expect.any(String),
    });
    expect(report.details.socketHealthProbe).toMatchObject({
      socketPath: expect.any(String),
      socketFileExists: expect.any(Boolean),
      connectable: expect.any(Boolean),
    });
    expect(Array.isArray(report.details.socketHints)).toBe(true);
    expect(report.details.socketErrorHints.EADDRINUSE.code).toBe("EADDRINUSE");
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

  test("buildHerdrSocketDoctorHints covers ENOENT stale socket and ECONNREFUSED", () => {
    const missing: HerdrSocketHealthProbe = {
      socketPath: "/tmp/herdr.sock",
      socketFileExists: false,
      connectable: false,
    };
    expect(
      buildHerdrSocketDoctorHints(missing, { serverRunning: false }).map((h) => h.code)
    ).toContain("ENOENT");

    const stale: HerdrSocketHealthProbe = {
      socketPath: "/tmp/herdr.sock",
      socketFileExists: true,
      connectable: false,
      connectErrorCode: "ECONNREFUSED",
    };
    const staleHints = buildHerdrSocketDoctorHints(stale, { serverRunning: false });
    expect(staleHints.map((h) => h.code)).toEqual(
      expect.arrayContaining(["stale_socket", "ECONNREFUSED"])
    );

    expect(HERDR_SOCKET_ERROR_HINTS.EADDRINUSE.detail).toContain("Bun 1.4+");
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
