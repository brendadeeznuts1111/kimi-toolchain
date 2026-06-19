// ── Effect Handler Benchmark (toolchain registry) ───────────────────

import { runEffectBenchmarks } from "../../../../src/harness/perf-monitor.ts";
import {
  evaluateEffectBenchmarkGate,
  type BenchmarkOptions,
} from "../../../../src/lib/effect-benchmark.ts";
import { jsonResponse } from "./api-handlers.ts";

export async function apiEffectBenchmark(): Promise<Response> {
  const opts: BenchmarkOptions = {
    projectRoot: process.cwd(),
  };
  const metrics = await runEffectBenchmarks(opts);
  const gate = await evaluateEffectBenchmarkGate(metrics, opts.projectRoot + "/thresholds.json");

  return jsonResponse({
    metrics: metrics.map((m) => ({
      name: m.registryKey ?? m.operation,
      symbol: m.symbol,
      operation: m.operation,
      actualMs: m.actualMs,
      thresholdMs: m.thresholdMs,
      pass: m.pass,
      skipped: m.skipped,
      skipReason: m.skipReason,
    })),
    allPass: gate.pass,
    registrySize: metrics.length,
    failures: gate.failures,
    philosophy:
      "src/harness/effect-handlers.ts → registerEffectBenchmark() → runEffectBenchmarks() → evaluateEffectBenchmarkGate(). Reuses the same closed-loop harness as kimi-doctor --perf-gates.",
  });
}
