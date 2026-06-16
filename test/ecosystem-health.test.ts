import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
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

  test("includes herdr tool health checks for toolchain repo", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });
    const herdrSync = report.checks.find((c) => c.name === "herdr-tools:desktop-sync");
    expect(herdrSync).toBeDefined();
    expect(herdrSync?.source).toBe("herdr");
  }, 15_000);

  test("includes constant-optimizer check for toolchain repo", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });
    const optimizerCheck = report.checks.find((c) => c.name.startsWith("constant-optimizer:"));
    expect(optimizerCheck).toBeDefined();
    expect(optimizerCheck?.source).toBe("constant-optimizer");
    if (optimizerCheck?.name !== "constant-optimizer:summary") {
      expect(optimizerCheck?.decisionIds).toBeDefined();
      expect(optimizerCheck?.confidence).toBeTypeOf("number");
    }
  }, 15_000);

  test("includes dx-cloudflare contract checks for toolchain repo", async () => {
    const report = await auditEcosystemHealth(REPO_ROOT, { home: tmpHome, quick: true });
    const cloudflareCheck = report.checks.find((c) => c.name === "dx-cloudflare:cloudflare-config");

    expect(cloudflareCheck).toBeDefined();
    expect(cloudflareCheck?.source).toBe("dx-cloudflare");
    expect(cloudflareCheck?.status).toBe("ok");
  }, 15_000);

  test("counts dx-cloudflare drift as warning without promoting it to blocker", async () => {
    const projectDir = join(tmpHome, "kimi-toolchain");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "kimi-toolchain" }));
    writeFileSync(
      join(projectDir, "dx.config.toml"),
      `
schemaVersion = 1
scope = "project"

[cloudflare]
mode = "read-only"

[cloudflare.dashboard]
source = "snapshot"
`
    );
    const alignedReport = await auditEcosystemHealth(projectDir, { home: tmpHome, quick: true });

    writeFileSync(
      join(projectDir, "dx.config.toml"),
      `
schemaVersion = 1
scope = "project"

[cloudflare]
mode = "read-only"

[cloudflare.dashboard]
source = "live-api"
`
    );

    const report = await auditEcosystemHealth(projectDir, { home: tmpHome, quick: true });
    const sourceCheck = report.checks.find(
      (c) => c.name === "dx-cloudflare:cloudflare.dashboard.source"
    );

    expect(sourceCheck?.status).toBe("warn");
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.blockers).toBe(alignedReport.blockers);
  }, 15_000);

  test("counts dx-github errors as blockers", async () => {
    const projectDir = join(tmpHome, "kimi-toolchain");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "kimi-toolchain" }));
    writeFileSync(join(projectDir, "dx.config.toml"), "schemaVersion = [\n");

    const report = await auditEcosystemHealth(projectDir, { home: tmpHome, quick: true });
    const dxConfig = report.checks.find((c) => c.name === "dx-github:dx-config");

    expect(dxConfig?.status).toBe("error");
    expect(report.blockers).toBeGreaterThan(0);
  }, 15_000);
});
