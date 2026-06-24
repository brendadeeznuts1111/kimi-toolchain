/**
 * Benchmark timing helpers aligned with Bun benchmarking docs.
 * @see https://bun.com/docs/project/benchmarking#measuring-time
 */

import { elapsedMs, nowNs } from "../../src/lib/timing.ts";

export interface BenchSampleMs {
  readonly iterations: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly opsPerSecond: number;
}

export interface BenchOptions {
  readonly warmup?: number;
}

function defaultWarmup(iterations: number): number {
  return Math.min(10, iterations);
}

export function summarizeBenchSamples(
  iterations: number,
  samplesMs: readonly number[]
): BenchSampleMs {
  const totalMs = samplesMs.reduce((sum, sample) => sum + sample, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...samplesMs);
  const maxMs = Math.max(...samplesMs);
  const opsPerSecond = avgMs > 0 ? 1000 / avgMs : 0;
  return { iterations, totalMs, avgMs, minMs, maxMs, opsPerSecond };
}

/** Microbenchmark sync fn with warmup; uses Bun.nanoseconds() per upstream guidance. */
export function benchSync(
  fn: () => void,
  iterations: number,
  opts: BenchOptions = {}
): BenchSampleMs {
  const warmup = opts.warmup ?? defaultWarmup(iterations);
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = nowNs();
    fn();
    samples.push(elapsedMs(start));
  }
  return summarizeBenchSamples(iterations, samples);
}

/** Microbenchmark async fn with warmup; uses Bun.nanoseconds() per upstream guidance. */
export async function benchAsync(
  fn: () => Promise<void>,
  iterations: number,
  opts: BenchOptions = {}
): Promise<BenchSampleMs> {
  const warmup = opts.warmup ?? defaultWarmup(iterations);
  for (let i = 0; i < warmup; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = nowNs();
    await fn();
    samples.push(elapsedMs(start));
  }
  return summarizeBenchSamples(iterations, samples);
}

export function formatBenchLine(name: string, sample: BenchSampleMs): string {
  const ops =
    sample.opsPerSecond >= 1000
      ? `${(sample.opsPerSecond / 1000).toFixed(1)}k ops/s`
      : `${sample.opsPerSecond.toFixed(1)} ops/s`;
  return (
    `  ${name.padEnd(30)} ${String(sample.iterations).padStart(6)} iters  ` +
    `avg ${sample.avgMs.toFixed(3).padStart(7)}ms  min ${sample.minMs.toFixed(3).padStart(7)}ms  ` +
    `max ${sample.maxMs.toFixed(3).padStart(7)}ms  ${ops}`
  );
}
