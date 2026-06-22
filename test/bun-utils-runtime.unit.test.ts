import { describe, expect, test } from "bun:test";
import {
  bunRuntimeReport,
  detectBunRuntime,
  formatBunRuntimeSnapshot,
  inferBunRuntimeChannel,
  inspectBunRuntime,
  inspectCpuRuntime,
  inspectHostRuntime,
  inspectMemoryRuntime,
  inspectOsRuntime,
  isBunEvalMain,
} from "../src/lib/bun-utils.ts";

describe("bun-utils-runtime", () => {
  test("detectBunRuntime reports live version", () => {
    const runtime = detectBunRuntime();
    expect(runtime.detected).toBe(true);
    expect(runtime.version).toBe(Bun.version);
    expect(runtime.revision).toBe(Bun.revision);
  });

  test("inferBunRuntimeChannel classifies semver strings", () => {
    expect(inferBunRuntimeChannel("1.4.0")).toBe("stable");
    expect(inferBunRuntimeChannel("1.4.0-canary.1")).toBe("canary");
    expect(inferBunRuntimeChannel("unknown")).toBe("unknown");
  });

  test("isBunEvalMain detects eval entrypoints", () => {
    expect(isBunEvalMain("[eval]")).toBe(true);
    expect(isBunEvalMain("/tmp/project/[eval]")).toBe(true);
    expect(isBunEvalMain("/tmp/project/script.ts")).toBe(false);
  });

  test("inspectOsRuntime reports host metadata", () => {
    const os = inspectOsRuntime();
    expect(os.platform).toBe(process.platform);
    expect(os.arch).toBe(process.arch);
    expect(os.type.length).toBeGreaterThan(0);
    expect(os.release.length).toBeGreaterThan(0);
    expect(os.hostname.length).toBeGreaterThan(0);
  });

  test("inspectCpuRuntime reports cores, model, and parallelism", () => {
    const cpu = inspectCpuRuntime();
    expect(cpu.arch).toBe(process.arch);
    expect(cpu.cores).toBeGreaterThan(0);
    expect(cpu.parallelism).toBeGreaterThan(0);
    expect(cpu.model.length).toBeGreaterThan(0);
  });

  test("inspectMemoryRuntime reports used and total bytes", () => {
    const memory = inspectMemoryRuntime();
    expect(memory.totalBytes).toBeGreaterThan(0);
    expect(memory.freeBytes).toBeGreaterThan(0);
    expect(memory.usedBytes).toBeGreaterThan(0);
    expect(memory.usedPercent).toBeGreaterThan(0);
    expect(memory.usedPercent).toBeLessThanOrEqual(100);
  });

  test("inspectBunRuntime includes os, cpu, memory, host, cwd, and revisionShort", () => {
    const snap = inspectBunRuntime();
    expect(snap.detected).toBe(true);
    expect(snap.main).toBe(Bun.main);
    expect(snap.processVersion).toBe(process.versions.bun);
    expect(snap.executable).toBe(Bun.which("bun"));
    expect(snap.channel).toMatch(/stable|canary/);
    expect(snap.os.platform).toBe(process.platform);
    expect(snap.os.arch).toBe(process.arch);
    expect(snap.cpu.cores).toBeGreaterThan(0);
    expect(snap.cpu.model.length).toBeGreaterThan(0);
    expect(snap.memory.totalBytes).toBeGreaterThan(0);
    expect(snap.host.pid).toBe(process.pid);
    expect(snap.cwd).toBe(process.cwd());
    expect(snap.revisionShort.length).toBeGreaterThan(0);
    expect(snap.revisionShort.length).toBeLessThanOrEqual(12);
  });

  test("formatBunRuntimeSnapshot includes engine row", () => {
    const snap = inspectBunRuntime();
    const text = formatBunRuntimeSnapshot(snap, {
      engineRange: ">=1.4.0",
      engineSatisfied: true,
      packageManager: "bun@1.4.0",
    });
    expect(text).toContain("Bun ");
    expect(text).toContain("memory:");
    expect(text).toContain("host:");
    expect(text).toContain("uptime:");
    expect(text).toContain("node:");
    expect(text).toContain("cpu:");
    expect(text).toContain("hostname:");
    expect(text).toContain("engine:");
    expect(text).toContain("pm:");
  });

  test("bunRuntimeReport checks package engine range", () => {
    const report = bunRuntimeReport(">=1.4.0");
    expect(report.engineRange).toBe(">=1.4.0");
    expect(report.engineSatisfied).toBe(true);
    expect(report.revisionShort).toMatch(/^[0-9a-f]{7,12}$/);
  });
});
