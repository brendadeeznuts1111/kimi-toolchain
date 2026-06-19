#!/usr/bin/env bun
/**
 * Performance control loop — perf benchmarks, gates, train, and file-triggered watch.
 *
 * Usage:
 *   bun run src/bin/perf-doctor.ts --perf-gates
 *   bun run src/bin/perf-doctor.ts --perf-gates --changed-only --base=origin/main
 *   bun run src/bin/perf-doctor.ts --report --out=./reports
 *   bun run src/bin/perf-doctor.ts --train --out=.
 *   bun run src/bin/perf-doctor.ts --watch --perf-gates --report
 */

import { join } from "path";
import { resolvePerfChangedFiles } from "../harness/changed-context.ts";
import { stopFileBenchServers } from "../harness/file-bench.ts";
import {
  generatePerfHTML,
  perfGate,
  runEffectBenchmarks,
  setThresholdsPath,
  trainThresholds,
} from "../harness/index.ts";
import { stopHttpBenchServers } from "../harness/http-bench.ts";
import { stopInstallBenchContext } from "../harness/install-bench.ts";
import { registryKeysForChanged } from "../harness/registry-scope.ts";
import {
  bindPerfWatchSignals,
  runPerfWatchLoop,
  unbindPerfWatchSignals,
} from "../harness/perf-watch.ts";
import type { BenchmarkOptions } from "../harness/perf-monitor.ts";
import type { Metric } from "../harness/types.ts";

const argv = Bun.argv.slice(2);
const PERF_GATES = argv.includes("--perf-gates");
const REPORT = argv.includes("--report");
const TRAIN = argv.includes("--train");
const WATCH = argv.includes("--watch");
const CHANGED_ONLY = argv.includes("--changed-only") || argv.includes("--changed");

/** Dashboard project root (examples/dashboard). */
const PROJECT_ROOT = join(import.meta.dir, "../..");

function parseBaseRef(): { base: string; baseExplicit: boolean } {
  const flag = argv.find((a) => a.startsWith("--base="));
  if (flag) return { base: flag.slice("--base=".length), baseExplicit: true };
  const idx = argv.indexOf("--base");
  if (idx >= 0 && argv[idx + 1]) {
    return { base: argv[idx + 1]!, baseExplicit: true };
  }
  return { base: "origin/main", baseExplicit: false };
}

function outDir(): string {
  const flag = argv.find((a) => a.startsWith("--out="));
  if (flag) return flag.slice("--out=".length);
  const idx = argv.indexOf("--out");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  return process.cwd();
}

async function resolveBenchmarkOptions(): Promise<BenchmarkOptions | undefined> {
  if (!CHANGED_ONLY) return undefined;

  const { base, baseExplicit } = parseBaseRef();
  const changed = await resolvePerfChangedFiles({
    changedOnly: true,
    base,
    baseExplicit,
  });
  const keys = registryKeysForChanged(changed);

  if (keys !== null && keys.length === 0) {
    console.log(`perf: no registry keys for ${changed.length} changed file(s) vs ${base}`);
    return { registryKeys: [] };
  }

  if (keys === null) {
    console.log(`perf: running full MODULE_REGISTRY (${changed.length} changed file(s) vs ${base})`);
    return undefined;
  }

  console.log(
    `perf: scoped to ${keys.length} registry key(s) vs ${base}: ${keys.join(", ")}`,
  );
  return { registryKeys: keys };
}

async function processMetrics(metrics: Metric[], dir: string): Promise<number> {
  const gate = perfGate(metrics);

  if (REPORT) {
    const html = generatePerfHTML(metrics);
    const reportPath = join(dir, "perf-report.html");
    await Bun.write(reportPath, html);
    console.log(`📊 Report written to ${reportPath}`);
  }

  if (TRAIN) {
    const result = await trainThresholds(metrics, dir);
    if (!result.written) {
      console.error("Train skipped — not all benchmarks passed");
      return 1;
    }
  }

  const measured = metrics.filter((m) => !m.skipped);
  if (measured.length === 0 && metrics.length === 0) {
    console.log("perf: skipped — no benchmarks selected");
    return 0;
  }

  const passCount = measured.filter((m) => m.pass).length;
  const skipped = metrics.filter((m) => m.skipped);
  console.log(`${passCount}/${measured.length} benchmarks within threshold`);
  if (skipped.length > 0) {
    for (const m of skipped) {
      console.log(`  ↷ ${m.registryKey ?? m.operation}: ${m.skipReason ?? "skipped"}`);
    }
  }

  if (PERF_GATES || TRAIN) {
    if (!gate.pass) {
      for (const line of gate.failures) console.error(`  ✗ ${line}`);
      return 1;
    }
  }

  return 0;
}

async function runOnce(dir: string): Promise<number> {
  const benchOpts = await resolveBenchmarkOptions();
  if (benchOpts?.registryKeys?.length === 0) return 0;

  let metrics;
  try {
    metrics = await runEffectBenchmarks(benchOpts);
  } catch (err) {
    console.error("Benchmark run failed:", err);
    return 1;
  }
  return processMetrics(metrics, dir);
}

async function main(): Promise<number> {
  const dir = outDir();
  setThresholdsPath(dir);

  if (WATCH) {
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    bindPerfWatchSignals(onSignal);

    try {
      await runPerfWatchLoop({
        projectRoot: PROJECT_ROOT,
        signal: controller.signal,
        onRun: async () => {
          const code = await runOnce(dir);
          if (code !== 0 && (PERF_GATES || TRAIN)) {
            process.stderr.write(`Watch run failed (exit ${code})\n`);
          }
        },
      });
    } finally {
      unbindPerfWatchSignals(onSignal);
    }
    return 0;
  }

  return runOnce(dir);
}

try {
  const code = await main();
  process.exit(code);
} finally {
  stopHttpBenchServers();
  stopFileBenchServers();
  stopInstallBenchContext();
}