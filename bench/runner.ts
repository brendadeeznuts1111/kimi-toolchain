#!/usr/bin/env bun
/**
 * Benchmark runner entry point.
 * Run with: bun run bench
 *
 * Organized into category files under bench/<category>/.
 * @see https://bun.com/docs/project/benchmarking
 */

import { formatBenchLine, type BenchSampleMs } from "./lib/timing.ts";
import { runSha256Benchmarks } from "./crypto/sha256.bench.ts";
import { runJsonParseBenchmarks } from "./parse/json.bench.ts";
import { runTomlParseBenchmarks } from "./parse/toml.bench.ts";
import { runNdjsonBenchmarks } from "./parse/ndjson.bench.ts";
import { runRScoreBenchmarks } from "./governance/r-score.bench.ts";
import { runRssBenchmarks } from "./memory/rss.bench.ts";
import { runOrphanProcessBenchmarks } from "./process/orphans.bench.ts";

interface BenchResult {
  readonly label: string;
  readonly sample: BenchSampleMs;
}

async function main() {
  console.log("══ Benchmark Suite ═══════════════════════════════════════════════");

  const results: BenchResult[] = [
    ...(await runSha256Benchmarks()),
    ...runJsonParseBenchmarks(),
    ...runTomlParseBenchmarks(),
    ...runNdjsonBenchmarks(),
    ...runRScoreBenchmarks(),
    ...runRssBenchmarks(),
    ...runOrphanProcessBenchmarks(),
  ];

  console.log("");
  for (const { label, sample } of results) {
    console.log(formatBenchLine(label, sample));
  }
  console.log("══════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
