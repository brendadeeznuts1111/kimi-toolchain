import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { removePath } from "../../src/lib/bun-io.ts";
import { perfGate, resetThresholdsPath, setThresholdsPath } from "../../src/guardian/perf-gate.ts";
import type { Metric } from "../../src/harness/html-reporter.ts";
import { withTempDir } from "../helpers.ts";

describe("perf-gate", () => {
  test("all metrics pass -> pass=true, failures empty", () => {
    const metrics: Metric[] = [
      {
        symbol: "Symbol(kimi.effect.image)",
        operation: "thumbnail",
        actualMs: 10,
        thresholdMs: 50,
        pass: true,
      },
    ];
    const { pass, failures } = perfGate(metrics);
    expect(pass).toBe(true);
    expect(failures).toEqual([]);
  });

  test("a metric exceeding threshold -> fail with message", () => {
    const metrics: Metric[] = [
      {
        symbol: "Symbol(kimi.effect.image)",
        operation: "thumbnail",
        actualMs: 120,
        thresholdMs: 50,
        pass: false,
      },
    ];
    const { pass, failures } = perfGate(metrics);
    expect(pass).toBe(false);
    expect(failures.join("\n")).toMatchSnapshot();
  });

  test("NaN actualMs still fails (NaN <= any threshold is false)", () => {
    const metrics: Metric[] = [
      {
        symbol: "Symbol(kimi.effect.broken)",
        operation: "parse",
        actualMs: NaN,
        thresholdMs: 100,
        pass: false,
      },
    ];
    const { pass } = perfGate(metrics);
    expect(pass).toBe(false);
  });

  test("uses metric's own threshold when no thresholds.json", () => {
    const metrics: Metric[] = [
      {
        symbol: "Symbol(kimi.effect.uuid)",
        operation: "generate",
        actualMs: 0.2,
        thresholdMs: 0.1,
        pass: false,
      },
    ];
    expect(perfGate(metrics).pass).toBe(false);
  });

  test("with a mock thresholds.json, overrides metric threshold", () => {
    withTempDir("perf-gate-thresholds", (dir) => {
      const thresholdsFile = join(dir, "thresholds.json");
      Bun.write(thresholdsFile, JSON.stringify({ "Symbol(kimi.effect.image).thumbnail": 200 }));
      setThresholdsPath(thresholdsFile);
      try {
        const metrics: Metric[] = [
          {
            symbol: "Symbol(kimi.effect.image)",
            operation: "thumbnail",
            actualMs: 150,
            thresholdMs: 50,
            pass: true,
          },
        ];
        const { pass } = perfGate(metrics);
        expect(pass).toBe(true);
      } finally {
        resetThresholdsPath();
        removePath(thresholdsFile, { force: true });
      }
    });
  });
});
