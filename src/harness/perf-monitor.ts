/**
 * perf-monitor.ts — Benchmark runner for registered effect handlers.
 *
 * Discovers handlers from globalThis via Symbol.for("kimi.effect.*"),
 * calls each exported method, and returns Metric rows for the
 * HTML reporter and perf gate.
 */
import type { Metric } from "./html-reporter.ts";

const EFFECT_PREFIX = "kimi.effect.";

function getEffect(name: string): unknown {
  const key = name.startsWith(EFFECT_PREFIX) ? name : `${EFFECT_PREFIX}${name}`;
  return (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
}

function discoverEffects(): Array<{ symbol: string; handler: Record<string, unknown> }> {
  const found: Array<{ symbol: string; handler: Record<string, unknown> }> = [];
  for (const sym of Object.getOwnPropertySymbols(globalThis as Record<symbol, unknown>)) {
    const key = Symbol.keyFor(sym);
    if (!key || !key.startsWith(EFFECT_PREFIX)) continue;
    const handler = (globalThis as Record<symbol, unknown>)[sym];
    if (typeof handler === "object" && handler !== null) {
      found.push({ symbol: key, handler: handler as Record<string, unknown> });
    }
  }
  return found;
}

async function callIfFunction(value: unknown, ...args: unknown[]): Promise<unknown> {
  if (typeof value === "function") {
    const result = value(...args);
    return result instanceof Promise ? await result : result;
  }
  return value;
}

/** Built-in threshold defaults per operation (ms). */
const DEFAULT_THRESHOLDS: Record<string, number> = {
  metadata: 5,
  placeholder: 50,
  thumbnail: 200,
  workload: 250,
};

// Minimal valid PNG (2×2 red pixel) for reproducible image benchmarks
const SAMPLE_PNG = new Uint8Array([
  0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0,
  0, 0xfd, 0xd4, 0x9a, 0x73, 0, 0, 0, 18, 73, 68, 65, 84, 8, 0xd7, 99, 0xf8, 0xcf, 0xc0, 0, 2, 12,
  0, 0, 9, 0, 1, 0x35, 0x8b, 0x5a, 0xc0, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 66, 96, 130,
]);

/** Get a test input appropriate for the effect type. */
function getTestInput(symbol: string, operation: string): unknown {
  if (symbol.includes("image")) {
    return SAMPLE_PNG;
  }
  return undefined;
}

export async function runEffectBenchmarks(): Promise<Metric[]> {
  const effects = discoverEffects();
  if (effects.length === 0) return [];

  // Register the image processor if available (template module self-registers)
  // but if not, we'll still discover whatever is on globalThis.

  const metrics: Metric[] = [];

  for (const { symbol, handler } of effects) {
    for (const [key, value] of Object.entries(handler)) {
      if (typeof value !== "function") continue;
      if (key === "workload") continue; // composite — benchmarked separately

      const thresholdMs = DEFAULT_THRESHOLDS[key] ?? 100;
      const start = Bun.nanoseconds();
      const testInput = getTestInput(symbol, key);
      // thumbnail takes (input, width) — pass width=200
      const args: unknown[] = key === "thumbnail" ? [testInput, 200] : [testInput];

      try {
        await callIfFunction(value, ...args);
      } catch {
        // Benchmark failed — record as failing metric
        const actualMs = (Bun.nanoseconds() - start) / 1_000_000;
        metrics.push({
          symbol,
          operation: key,
          actualMs: Math.round(actualMs * 1000) / 1000,
          thresholdMs,
          pass: false,
          registryKey: `${symbol}.${key}`,
        });
        continue;
      }

      const actualMs = (Bun.nanoseconds() - start) / 1_000_000;
      metrics.push({
        symbol,
        operation: key,
        actualMs: Math.round(actualMs * 1000) / 1000,
        thresholdMs,
        pass: actualMs <= thresholdMs,
        registryKey: `${symbol}.${key}`,
      });
    }

    // Also benchmark composite workload if present
    if (typeof handler.workload === "function") {
      const thresholdMs = DEFAULT_THRESHOLDS["workload"] ?? 250;
      const start = Bun.nanoseconds();
      try {
        await callIfFunction(handler.workload);
        const actualMs = (Bun.nanoseconds() - start) / 1_000_000;
        metrics.push({
          symbol,
          operation: "workload",
          actualMs: Math.round(actualMs * 1000) / 1000,
          thresholdMs,
          pass: actualMs <= thresholdMs,
          registryKey: `${symbol}.workload`,
        });
      } catch {
        metrics.push({
          symbol,
          operation: "workload",
          actualMs: (Bun.nanoseconds() - start) / 1_000_000,
          thresholdMs,
          pass: false,
          registryKey: `${symbol}.workload`,
        });
      }
    }
  }

  return metrics;
}
