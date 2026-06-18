import { afterEach, describe, expect, test } from "bun:test";
import { BUILTIN_DEFAULTS, resolveHardwareParallelism } from "../src/lib/governor-config.ts";

type BunWithParallelism = typeof Bun & {
  availableParallelism?: () => number;
};

describe("governor-config", () => {
  const bunRef = Bun as BunWithParallelism;
  const originalAvailableParallelism = bunRef.availableParallelism;
  const originalHardwareConcurrency = navigator.hardwareConcurrency;

  afterEach(() => {
    if (originalAvailableParallelism === undefined) {
      delete bunRef.availableParallelism;
    } else {
      bunRef.availableParallelism = originalAvailableParallelism;
    }
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: originalHardwareConcurrency,
      configurable: true,
    });
  });

  test("resolveHardwareParallelism prefers Bun.availableParallelism when present", () => {
    bunRef.availableParallelism = () => 8;
    expect(resolveHardwareParallelism()).toBe(8);
  });

  test("resolveHardwareParallelism falls back to navigator.hardwareConcurrency", () => {
    delete bunRef.availableParallelism;
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 6,
      configurable: true,
    });
    expect(resolveHardwareParallelism()).toBe(6);
  });

  test("resolveHardwareParallelism falls back to 4 when unavailable", () => {
    delete bunRef.availableParallelism;
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 0,
      configurable: true,
    });
    expect(resolveHardwareParallelism()).toBe(4);
  });

  test("resolveHardwareParallelism ignores non-positive cgroup values", () => {
    bunRef.availableParallelism = () => 0;
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 12,
      configurable: true,
    });
    expect(resolveHardwareParallelism()).toBe(12);
  });

  test("BUILTIN maxParallelJobs is at least 2", () => {
    expect(BUILTIN_DEFAULTS.maxParallelJobs).toBeGreaterThanOrEqual(2);
  });

  test("BUILTIN maxParallelJobs uses 75% of resolved parallelism", () => {
    const parallelism = resolveHardwareParallelism();
    expect(BUILTIN_DEFAULTS.maxParallelJobs).toBe(Math.max(2, Math.floor(parallelism * 0.75)));
  });
});
