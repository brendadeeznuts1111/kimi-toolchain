/**
 * Unit tests for defaults-config.ts
 */

import { describe, test, expect, afterEach } from "bun:test";
import { testTempDir } from "../test/helpers.ts";
import {
  loadDxDefaultsSync,
  loadDxDefaults,
  mergeDefaults,
  invalidateDefaultsCache,
  type DefaultsConfig,
} from "../src/lib/defaults-config.ts";
import { join } from "path";

function makeDir(): string {
  return testTempDir("kimi-defaults-config");
}

function writeDxConfig(dir: string, defaults: Record<string, unknown>): void {
  const toml = [
    "schemaVersion = 1",
    'name = "test"',
    'scope = "project"',
    'mode = "development"',
    "",
    "[defaults]",
    ...Object.entries(defaults).map(([k, v]) => {
      if (typeof v === "string") return `${k} = "${v}"`;
      return `${k} = ${v}`;
    }),
  ].join("\n");
  Bun.write(join(dir, "dx.config.toml"), toml);
}

afterEach(() => {
  invalidateDefaultsCache();
});

describe("defaults-config sync", () => {
  test("sync: returns null when dx.config.toml is missing", () => {
    const result = loadDxDefaultsSync(makeDir());
    expect(result).toBeNull();
  });

  test("parses a complete [defaults] table", () => {
    const dir = makeDir();
    writeDxConfig(dir, {
      toolTimeoutMs: 30000,
      agentToolTimeoutMs: 15000,
      toolGracePeriodMs: 5000,
      toolMaxOutputBytes: 1048576,
      processCacheTtlMs: 1000,
      governorMaxMemoryMB: 512,
      governorMaxCpuTimeMs: 30000,
      governorMaxParallelJobs: 4,
      governorCacheTTLSeconds: 300,
      governorWallClockMs: 300000,
      governorMaxFileSizeMB: 100,
      governorMaxOpenFiles: 256,
      governorDiskQuotaMB: 1024,
      cloudflareTimeoutMs: 30000,
      cloudflareRetries: 2,
      cloudflareBaseDelayMs: 500,
      cloudflareTokenWarnDays: 30,
      agentsMaxLines: 900,
      contextMaxLines: 120,
      discoveryCacheTtlMs: 5000,
      dashboardStaleMs: 15000,
    });

    const config = loadDxDefaultsSync(dir);
    expect(config).not.toBeNull();
    expect(config!.toolTimeoutMs).toBe(30000);
    expect(config!.agentToolTimeoutMs).toBe(15000);
    expect(config!.governorMaxParallelJobs).toBe(4);
    expect(config!.discoveryCacheTtlMs).toBe(5000);
  });

  test("parses numeric strings", () => {
    const dir = makeDir();
    writeDxConfig(dir, {
      toolTimeoutMs: "30_000",
      governorMaxMemoryMB: "512",
    });

    const config = loadDxDefaultsSync(dir);
    expect(config).not.toBeNull();
    expect(config!.toolTimeoutMs).toBe(30000);
    expect(config!.governorMaxMemoryMB).toBe(512);
  });

  test("skips non-numeric values", () => {
    const dir = makeDir();
    writeDxConfig(dir, {
      toolTimeoutMs: "fast",
      governorMaxMemoryMB: 512,
    });

    const config = loadDxDefaultsSync(dir);
    expect(config).not.toBeNull();
    expect(config!.toolTimeoutMs).toBeUndefined();
    expect(config!.governorMaxMemoryMB).toBe(512);
  });

  test("caches results", () => {
    const dir = makeDir();
    writeDxConfig(dir, { toolTimeoutMs: 30000 });

    const a = loadDxDefaultsSync(dir);
    const b = loadDxDefaultsSync(dir);
    expect(a).toBe(b); // same object reference
  });

  test("invalidateCache clears entry", () => {
    const dir = makeDir();
    writeDxConfig(dir, { toolTimeoutMs: 30000 });

    const a = loadDxDefaultsSync(dir);
    invalidateDefaultsCache(dir);
    const b = loadDxDefaultsSync(dir);
    expect(a).not.toBe(b); // different after invalidate
    expect(b!.toolTimeoutMs).toBe(30000);
  });
});

describe("defaults-config async", () => {
  test("async: returns null when dx.config.toml is missing", async () => {
    const result = await loadDxDefaults(makeDir());
    expect(result).toBeNull();
  });

  test("parses a partial [defaults] table", async () => {
    const dir = makeDir();
    writeDxConfig(dir, {
      toolTimeoutMs: 45000,
      cloudflareRetries: 3,
    });

    const config = await loadDxDefaults(dir);
    expect(config).not.toBeNull();
    expect(config!.toolTimeoutMs).toBe(45000);
    expect(config!.cloudflareRetries).toBe(3);
  });
});

describe("defaults-config merge", () => {
  test("returns source unchanged when dx is null", () => {
    const { config, fromDx } = mergeDefaults({ toolTimeoutMs: 12345 }, null);
    expect(config.toolTimeoutMs).toBe(12345);
    expect(fromDx).toBe(false);
  });

  test("fills missing values from dx", () => {
    const dx: DefaultsConfig = {
      toolTimeoutMs: 30000,
      agentToolTimeoutMs: 15000,
      toolGracePeriodMs: 5000,
      toolMaxOutputBytes: 1048576,
      processCacheTtlMs: 1000,
      governorMaxMemoryMB: 512,
      governorMaxCpuTimeMs: 30000,
      governorMaxParallelJobs: 2,
      governorCacheTTLSeconds: 300,
      governorWallClockMs: 300000,
      governorMaxFileSizeMB: 100,
      governorMaxOpenFiles: 256,
      governorDiskQuotaMB: 1024,
      cloudflareTimeoutMs: 30000,
      cloudflareRetries: 2,
      cloudflareBaseDelayMs: 500,
      cloudflareTokenWarnDays: 30,
      agentsMaxLines: 900,
      contextMaxLines: 120,
      discoveryCacheTtlMs: 5000,
      dashboardStaleMs: 15000,
    };

    const { config, fromDx } = mergeDefaults({}, dx);
    expect(config.toolTimeoutMs).toBe(30000);
    expect(fromDx).toBe(true);
  });

  test("does not override existing values", () => {
    const dx: DefaultsConfig = {
      toolTimeoutMs: 99999,
      agentToolTimeoutMs: 15000,
      toolGracePeriodMs: 5000,
      toolMaxOutputBytes: 1048576,
      processCacheTtlMs: 1000,
      governorMaxMemoryMB: 512,
      governorMaxCpuTimeMs: 30000,
      governorMaxParallelJobs: 2,
      governorCacheTTLSeconds: 300,
      governorWallClockMs: 300000,
      governorMaxFileSizeMB: 100,
      governorMaxOpenFiles: 256,
      governorDiskQuotaMB: 1024,
      cloudflareTimeoutMs: 30000,
      cloudflareRetries: 2,
      cloudflareBaseDelayMs: 500,
      cloudflareTokenWarnDays: 30,
      agentsMaxLines: 900,
      contextMaxLines: 120,
      discoveryCacheTtlMs: 5000,
      dashboardStaleMs: 15000,
    };

    const { config, fromDx } = mergeDefaults({ toolTimeoutMs: 12345 }, dx);
    expect(config.toolTimeoutMs).toBe(12345); // source wins
    expect(config.agentToolTimeoutMs).toBe(15000); // dx fills missing
    expect(fromDx).toBe(true);
  });
});
