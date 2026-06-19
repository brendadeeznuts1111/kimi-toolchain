/**
 * perf-monitor.ts — Benchmark runner for registered effect handlers.
 *
 * Re-exports the canonical harness from src/lib/effect-benchmark.ts and
 * auto-imports the built-in handlers so they are discoverable by default.
 */

import {
  runEffectBenchmarks as runRegisteredBenchmarks,
  type BenchmarkOptions,
} from "../lib/effect-benchmark.ts";
import "./effect-handlers.ts";

export { type BenchmarkOptions };

/**
 * Run all registered effect-handler benchmarks.
 * Built-in handlers are registered when this module is first imported.
 */
export async function runEffectBenchmarks(
  opts?: BenchmarkOptions
): Promise<ReturnType<typeof runRegisteredBenchmarks>> {
  return runRegisteredBenchmarks(opts);
}
