import { describe, expect, test } from "bun:test";
import { elapsedMs, isExpired, MIN_PERF_NOW_MS, nowMs, nowNs, nsToMs } from "../src/lib/timing.ts";
import {
  benchAsync,
  benchSync,
  formatBenchLine,
  summarizeBenchSamples,
} from "../bench/lib/timing.ts";
import { BUN_MEASURING_TIME_DOC_URL } from "../src/lib/bun-install-config.ts";

describe("timing", () => {
  test("nowMs and isExpired use performance.now wall clock", () => {
    const start = nowMs();
    expect(start).toBeGreaterThan(0);
    expect(isExpired(start, 60_000)).toBe(false);
    expect(isExpired(start - 120_000, 60_000)).toBe(true);
  });

  test("Bun.nanoseconds helpers convert to milliseconds", () => {
    const start = nowNs();
    Bun.sleepSync(1);
    const ms = elapsedMs(start);
    expect(ms).toBeGreaterThan(0);
    expect(nsToMs(1_500_000)).toBe(1.5);
  });

  test("MIN_PERF_NOW_MS documents sub-ms resolution limit", () => {
    expect(MIN_PERF_NOW_MS).toBe(1);
    expect(BUN_MEASURING_TIME_DOC_URL).toContain("benchmarking#measuring-time");
  });
});

describe("bench-timing", () => {
  test("benchSync warms up and returns aggregate stats", () => {
    let count = 0;
    const sample = benchSync(() => {
      count += 1;
    }, 20);
    expect(count).toBeGreaterThanOrEqual(30);
    expect(sample.iterations).toBe(20);
    expect(sample.avgMs).toBeGreaterThanOrEqual(0);
    expect(sample.opsPerSecond).toBeGreaterThan(0);
  });

  test("benchAsync measures async workloads", async () => {
    const sample = await benchAsync(async () => {
      await Bun.sleep(0);
    }, 5);
    expect(sample.iterations).toBe(5);
    expect(sample.maxMs).toBeGreaterThanOrEqual(sample.minMs);
  });

  test("summarizeBenchSamples and formatBenchLine render bench rows", () => {
    const sample = summarizeBenchSamples(2, [1, 3]);
    expect(sample.avgMs).toBe(2);
    expect(sample.minMs).toBe(1);
    expect(sample.maxMs).toBe(3);
    const line = formatBenchLine("demo", sample);
    expect(line).toContain("demo");
    expect(line).toContain("2 iters");
  });
});
