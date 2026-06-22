#!/usr/bin/env bun
/**
 * Lightweight benchmark suite for performance-critical paths.
 * Run with: bun run bench
 *
 * Uses Bun.nanoseconds() via src/lib/timing.ts — @see bun.com/docs/project/benchmarking
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
import { benchAsync, benchSync, formatBenchLine, type BenchSampleMs } from "../src/lib/timing.ts";

const REPO_ROOT = import.meta.dir + "/..";

async function main() {
  console.log("══ Benchmark Suite ═══════════════════════════════════════════════");
  const results: BenchSampleMs[] = [];
  const labels: string[] = [];

  const push = (name: string, sample: BenchSampleMs) => {
    labels.push(name);
    results.push(sample);
  };

  push(
    "sha256String (1KB)",
    benchSync(() => {
      sha256String("x".repeat(1024));
    }, 10_000)
  );

  const pkgPath = REPO_ROOT + "/package.json";
  push(
    "sha256File (package.json)",
    await benchAsync(async () => {
      await sha256File(pkgPath);
    }, 100)
  );

  const jsonPayload = JSON.stringify({ a: 1, b: "test", c: [1, 2, 3] });
  push(
    "safeParse (small object)",
    benchSync(() => {
      safeParse(jsonPayload, {});
    }, 50_000)
  );

  const tomlPayload = '[section]\nkey = "value"\nnum = 42\n';
  push(
    "safeToml (small table)",
    benchSync(() => {
      safeToml(tomlPayload, {});
    }, 20_000)
  );

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
  push(
    "computeRScore (full)",
    benchSync(() => {
      computeRScore(rScoreInput);
    }, 100_000)
  );

  push(
    "getChromeRssMB (cold)",
    benchSync(() => {
      clearMemCache();
      getChromeRssMB();
    }, 50)
  );

  push(
    "getAppRssGroups (cold)",
    benchSync(() => {
      clearMemCache();
      getAppRssGroups();
    }, 50)
  );

  push(
    "getAppRssGroups+cachedRss",
    benchSync(() => {
      getAppRssGroups();
      getChromeRssMB();
    }, 50)
  );

  push(
    "getOrphanProcesses (cold)",
    benchSync(() => {
      clearProcessCache();
      getOrphanProcesses();
    }, 50)
  );

  push(
    "getOrphanProcesses (cached)",
    benchSync(() => {
      getOrphanProcesses();
    }, 50)
  );

  const asciiRecords =
    Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: i, name: `item-${i}`, ts: Date.now() })
    ).join("\n") + "\n";
  push(
    "parseNdjsonText (1k ASCII records)",
    benchSync(() => {
      parseNdjsonText(asciiRecords);
    }, 5_000)
  );

  push(
    "Bun.JSONL.parse (1k ASCII, direct)",
    benchSync(() => {
      Bun.JSONL.parse(asciiRecords);
    }, 5_000)
  );

  const errorRecords =
    Array.from({ length: 1000 }, (_, i) =>
      i % 100 === 50 ? "{invalid}" : JSON.stringify({ id: i, name: `item-${i}` })
    ).join("\n") + "\n";
  push(
    "parseNdjsonText (1k records, 10 errors)",
    benchSync(() => {
      parseNdjsonText(errorRecords);
    }, 2_000)
  );

  const utf8Records =
    Array.from({ length: 500 }, (_, i) =>
      JSON.stringify({ id: i, name: `アイテム-${i}-🎉`, tag: "日本語" })
    ).join("\n") + "\n";
  push(
    "parseNdjsonText (500 UTF-8 records)",
    benchSync(() => {
      parseNdjsonText(utf8Records);
    }, 2_000)
  );

  const largeRecord =
    JSON.stringify({
      data: "x".repeat(100_000),
      meta: { ts: Date.now(), version: "1.0.0" },
    }) + "\n";
  push(
    "parseNdjsonText (1x 100KB record)",
    benchSync(() => {
      parseNdjsonText(largeRecord);
    }, 10_000)
  );

  console.log("");
  for (let i = 0; i < results.length; i++) {
    console.log(formatBenchLine(labels[i]!, results[i]!));
  }
  console.log("══════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
