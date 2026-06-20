import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { rmSync } from "fs";
import {
  loadThresholds,
  loadBunfigThresholds,
  overrideThresholds,
  resetThresholdCache,
  runEffectBenchmarks,
  setThresholdsPath,
  trainThresholds,
  thresholdKeyFor,
} from "../index.ts";
import { DEFAULT_THRESHOLDS } from "../module-registry.ts";

const tmpDir = join(import.meta.dir, ".tmp-thresholds");

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetThresholdCache(tmpDir);
  setThresholdsPath(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetThresholdCache();
});

describe("perf harness thresholds loop", () => {
  test("loadThresholds merges toolchain layers over defaults when no trained file", async () => {
    const t = await loadThresholds();
    expect(t["kimi.effect.crypto.sha256"]).toBeLessThan(
      DEFAULT_THRESHOLDS["kimi.effect.crypto.sha256"]
    );
    expect(t["kimi.effect.crypto.sha256"]).toBeGreaterThan(0);
  });

  test("loadThresholds merges trained thresholds.json over toolchain layers", async () => {
    const path = join(tmpDir, "thresholds.json");
    await Bun.write(path, JSON.stringify({ "kimi.effect.crypto.sha256": 0.001 }));
    resetThresholdCache(tmpDir);
    setThresholdsPath(tmpDir);

    const t = await loadThresholds();
    expect(t["kimi.effect.crypto.sha256"]).toBe(0.001);
    expect(t["kimi.effect.util.inspect"]).toBeLessThan(
      DEFAULT_THRESHOLDS["kimi.effect.util.inspect"]
    );
  });

  test("runEffectBenchmarks uses trained threshold for pass/fail", async () => {
    const path = join(tmpDir, "thresholds.json");
    await Bun.write(path, JSON.stringify({ "kimi.effect.crypto.sha256": 0.0001 }));
    resetThresholdCache(tmpDir);
    setThresholdsPath(tmpDir);

    const metrics = await runEffectBenchmarks();
    const crypto = metrics.find((m) => m.registryKey === "crypto.sha256");
    expect(crypto).toBeDefined();
    expect(crypto!.thresholdMs).toBe(0.0001);
    expect(crypto!.pass).toBe(false);
  });

  test("trainThresholds writes actualMs * 1.1 when all pass", async () => {
    const metrics = await runEffectBenchmarks();
    const passing = metrics.map((m) => ({
      ...m,
      pass: true,
      thresholdMs: m.actualMs * 10,
    }));

    const result = await trainThresholds(passing, tmpDir);
    expect(result.written).toBe(true);

    resetThresholdCache(tmpDir);
    const loaded = await loadThresholds();
    const key = thresholdKeyFor("crypto.sha256");
    expect(loaded[key]).toBeGreaterThan(0);
  });

  test("trainThresholds skips write when any metric fails", async () => {
    const metrics = await runEffectBenchmarks();
    if (metrics.every((m) => m.pass)) {
      metrics[0]!.pass = false;
    }
    const result = await trainThresholds(metrics, tmpDir);
    expect(result.written).toBe(false);
    expect(await Bun.file(join(tmpDir, "thresholds.json")).exists()).toBe(false);
  });

  test("bunfig thresholds override trained values", async () => {
    await Bun.write(
      join(tmpDir, "bunfig.toml"),
      `[doctor.thresholds]\n"kimi.effect.crypto.sha256" = 0.0001\n`
    );
    await Bun.write(
      join(tmpDir, "thresholds.json"),
      JSON.stringify({ "kimi.effect.crypto.sha256": 50 })
    );
    resetThresholdCache(tmpDir);
    setThresholdsPath(tmpDir);

    const bunfig = await loadBunfigThresholds(tmpDir);
    expect(bunfig["kimi.effect.crypto.sha256"]).toBe(0.0001);

    const metrics = await runEffectBenchmarks();
    const crypto = metrics.find((m) => m.registryKey === "crypto.sha256");
    expect(crypto!.thresholdMs).toBe(0.0001);
    expect(crypto!.pass).toBe(false);
  });

  test("programmatic overrides win over bunfig and trained", async () => {
    await Bun.write(
      join(tmpDir, "thresholds.json"),
      JSON.stringify({ "kimi.effect.crypto.sha256": 50 })
    );
    resetThresholdCache(tmpDir);
    setThresholdsPath(tmpDir);
    overrideThresholds({ "kimi.effect.crypto.sha256": 0.0001 });

    const t = await loadThresholds();
    expect(t["kimi.effect.crypto.sha256"]).toBe(0.0001);
  });
});
