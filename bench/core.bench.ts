#!/usr/bin/env bun
/**
 * Lightweight benchmark suite for performance-critical paths.
 * Run with: bun run bench
 *
 * Uses Bun.nanoseconds() for high-resolution timing.
 * No external dependencies.
 */

import { sha256File, sha256String, safeParse, safeToml } from "../src/lib/utils.ts";
import { computeRScore } from "../src/lib/r-score.ts";
import { getOrphanProcesses, clearProcessCache } from "../src/lib/process-utils.ts";
import {
  getChromeRssMB,
  getAppRssGroups,
  clearProcessCache as clearMemCache,
} from "../src/lib/memory-budget.ts";
import { parseNdjsonText } from "../src/lib/ndjson.ts";

const REPO_ROOT = import.meta.dir + "/..";

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSecond: number;
}

function bench(name: string, fn: () => void, iterations: number): BenchmarkResult {
  const times: number[] = [];
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) fn();
  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = Bun.nanoseconds();
    fn();
    const end = Bun.nanoseconds();
    times.push((end - start) / 1_000_000);
  }
  const totalMs = times.reduce((s, t) => s + t, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSecond = 1000 / avgMs;
  return { name, iterations, totalMs, avgMs, minMs, maxMs, opsPerSecond };
}

async function benchAsync(
  name: string,
  fn: () => Promise<void>,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];
  for (let i = 0; i < Math.min(10, iterations); i++) await fn();
  for (let i = 0; i < iterations; i++) {
    const start = Bun.nanoseconds();
    await fn();
    const end = Bun.nanoseconds();
    times.push((end - start) / 1_000_000);
  }
  const totalMs = times.reduce((s, t) => s + t, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSecond = 1000 / avgMs;
  return { name, iterations, totalMs, avgMs, minMs, maxMs, opsPerSecond };
}

function printResult(r: BenchmarkResult): void {
  const ops =
    r.opsPerSecond >= 1000
      ? `${(r.opsPerSecond / 1000).toFixed(1)}k ops/s`
      : `${r.opsPerSecond.toFixed(1)} ops/s`;
  console.log(
    `  ${r.name.padEnd(30)} ${String(r.iterations).padStart(6)} iters  ` +
      `avg ${r.avgMs.toFixed(3).padStart(7)}ms  min ${r.minMs.toFixed(3).padStart(7)}ms  ` +
      `max ${r.maxMs.toFixed(3).padStart(7)}ms  ${ops}`
  );
}

async function main() {
  console.log("══ Benchmark Suite ═══════════════════════════════════════════════");
  const results: BenchmarkResult[] = [];

  // sha256String (in-memory, no I/O)
  results.push(
    bench("sha256String (1KB)", () => {
      sha256String("x".repeat(1024));
    }, 10_000)
  );

  // sha256File (disk I/O)
  const pkgPath = REPO_ROOT + "/package.json";
  results.push(
    await benchAsync(
      "sha256File (package.json)",
      async () => {
        await sha256File(pkgPath);
      },
      100
    )
  );

  // safeParse
  const jsonPayload = JSON.stringify({ a: 1, b: "test", c: [1, 2, 3] });
  results.push(
    bench("safeParse (small object)", () => {
      safeParse(jsonPayload, {});
    }, 50_000)
  );

  // safeToml
  const tomlPayload = '[section]\nkey = "value"\nnum = 42\n';
  results.push(
    bench("safeToml (small table)", () => {
      safeToml(tomlPayload, {});
    }, 20_000)
  );

  // computeRScore
  const rScoreInput = {
    hasLicense: true,
    hasContributing: true,
    hasCodeowners: true,
    hasReadme: true,
    hasContext: true,
    hasChangelog: true,
    coveragePercentage: 85,
    docsFresh: true,
    staleLockfile: false,
  };
  results.push(
    bench("computeRScore (full)", () => {
      computeRScore(rScoreInput);
    }, 100_000)
  );

  // getChromeRssMB (system call — cold, no cache)
  results.push(
    bench("getChromeRssMB (cold)", () => {
      clearMemCache();
      getChromeRssMB();
    }, 50)
  );

  // getAppRssGroups (system call — cold, no cache)
  results.push(
    bench("getAppRssGroups (cold)", () => {
      clearMemCache();
      getAppRssGroups();
    }, 50)
  );

  // getAppRssGroups + getChromeRssMB (cached — same ps call)
  results.push(
    bench("getAppRssGroups+cachedRss", () => {
      getAppRssGroups();
      getChromeRssMB();
    }, 50)
  );

  // getOrphanProcesses (system call — cold)
  results.push(
    bench("getOrphanProcesses (cold)", () => {
      clearProcessCache();
      getOrphanProcesses();
    }, 50)
  );

  // getOrphanProcesses (cached)
  results.push(
    bench("getOrphanProcesses (cached)", () => {
      getOrphanProcesses();
    }, 50)
  );

  // ── JSONL / NDJSON hot paths ──────────────────────────────────────

  // ASCII fast path — 1000 small records (zero-alloc StringView)
  const asciiRecords =
    Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: i, name: `item-${i}`, ts: Date.now() })
    ).join("\n") + "\n";
  results.push(
    bench("parseNdjsonText (1k ASCII records)", () => {
      parseNdjsonText(asciiRecords);
    }, 5_000)
  );

  // Bun.JSONL.parse direct (baseline — no error recovery overhead)
  results.push(
    bench("Bun.JSONL.parse (1k ASCII, direct)", () => {
      Bun.JSONL.parse(asciiRecords);
    }, 5_000)
  );

  // Error recovery path — 1000 records with 10 invalid lines
  const errorRecords =
    Array.from({ length: 1000 }, (_, i) =>
      i % 100 === 50 ? "{invalid}" : JSON.stringify({ id: i, name: `item-${i}` })
    ).join("\n") + "\n";
  results.push(
    bench("parseNdjsonText (1k records, 10 errors)", () => {
      parseNdjsonText(errorRecords);
    }, 2_000)
  );

  // Non-ASCII / multi-byte (UTF-8 SIMD path)
  const utf8Records =
    Array.from({ length: 500 }, (_, i) =>
      JSON.stringify({ id: i, name: `アイテム-${i}-🎉`, tag: "日本語" })
    ).join("\n") + "\n";
  results.push(
    bench("parseNdjsonText (500 UTF-8 records)", () => {
      parseNdjsonText(utf8Records);
    }, 2_000)
  );

  // Single large record (100KB JSON object)
  const largeRecord =
    JSON.stringify({
      data: "x".repeat(100_000),
      meta: { ts: Date.now(), version: "1.0.0" },
    }) + "\n";
  results.push(
    bench("parseNdjsonText (1x 100KB record)", () => {
      parseNdjsonText(largeRecord);
    }, 10_000)
  );

  console.log("");
  for (const r of results) printResult(r);
  console.log("══════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
