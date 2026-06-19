import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { auditEcosystemHealth } from "../src/lib/ecosystem-health.ts";

const REPO_ROOT = import.meta.dir + "/..";
let tmpHome: string;

beforeEach(() => {
  tmpHome = join(tmpdir(), `eco-health-${Bun.randomUUIDv7()}`);
  mkdirSync(tmpHome, { recursive: true });
  mkdirSync(join(tmpHome, ".local", "bin"), { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
});

describe("ecosystem-health", () => {
  test("returns structured report with checks and fixPlan", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });

    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(typeof report.blockers).toBe("number");
    expect(typeof report.warnings).toBe("number");
    expect(Array.isArray(report.fixPlan)).toBe(true);

    const workspaceChecks = report.checks.filter((c) => c.source === "workspace");
    expect(workspaceChecks.length).toBeGreaterThan(0);
  }, 15_000);

  test("includes fixPlan when wrappers missing", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });
    const missingWrapper = report.checks.find(
      (c) => c.name === "wrapper-coverage" && c.status === "error"
    );
    if (missingWrapper) {
      expect(
        report.fixPlan.some((s) => s.includes("install-wrappers") || s.includes("--fix"))
      ).toBe(true);
    }
  }, 15_000);

  test("includes desktop-sync check for toolchain repo", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });
    const syncCheck = report.checks.find((c) => c.name === "desktop-sync");
    expect(syncCheck).toBeDefined();
    expect(syncCheck?.source).toBe("sync");
  }, 15_000);
});
