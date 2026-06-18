#!/usr/bin/env bun
/**
 * Quality gate runner with --dry-run, --staged, --timeout, and fast-gate flags.
 *
 * Usage:
 *   bun run scripts/check.ts --fast --changed-only --fail-fast --skip-tests
 *   bun run scripts/check.ts --fast --json-summary
 *   bun run scripts/check.ts --fast --watch
 *   bun run scripts/check.ts --fast --watch-tests
 *   bun run scripts/check.ts --fast --cache-results
 *   bun run scripts/check.ts --dry-run --watch
 *
 * Gates are silent on success by default. Use --verbose or set KIMI_VERBOSE=1
 * to stream full output. Failures are always verbose.
 *
 * @see https://bun.com/docs/guides/test/timeout
 */

import { join } from "path";
import { FAST_TEST_TIMEOUT_MS, DEFAULT_TEST_TIMEOUT_MS } from "../src/lib/test-gates.ts";
import type { CheckOptions, CheckRunResult } from "../src/lib/check-types.ts";
import {
  computeCheckCacheKey,
  loadCheckCache,
  saveCheckCache,
  shouldPersistCheckCache,
} from "../src/lib/check-result-cache.ts";
import { printWatchDryRun, printWatchTestsDryRun } from "../src/lib/check-watch.ts";
import { startCheckWatchMode } from "./check-watch-runner.ts";
import {
  prepareDryRunSteps,
  printCheckDryRun,
  printCheckResult,
  runCheckPipeline,
  runTestOnlyPipeline,
} from "../src/lib/check-pipeline.ts";
import { ensureQuietEnv } from "../src/lib/quiet-mode.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseTimeout(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --timeout: ${raw ?? ""}`);
  }
  return value;
}

function parseCli(): CheckOptions {
  const argv = Bun.argv.slice(2);
  let dryRun = false;
  let fast = false;
  let staged = false;
  let verbose = false;
  let timeoutMs = DEFAULT_TEST_TIMEOUT_MS;
  let changedOnly = false;
  let base = "main";
  let baseExplicit = false;
  let failFast = false;
  let jsonSummary = false;
  let skipTests = false;
  let watch = false;
  let watchTests = false;
  let cacheResults = false;
  let noCache = false;
  let profile = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
      continue;
    }
    if (arg === "--fast") {
      fast = true;
      continue;
    }
    if (arg === "--staged") {
      staged = true;
      fast = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--changed-only") {
      changedOnly = true;
      continue;
    }
    if (arg === "--fail-fast") {
      failFast = true;
      continue;
    }
    if (arg === "--json-summary") {
      jsonSummary = true;
      continue;
    }
    if (arg === "--skip-tests") {
      skipTests = true;
      continue;
    }
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    if (arg === "--watch-tests") {
      watchTests = true;
      watch = true;
      continue;
    }
    if (arg === "--cache-results") {
      cacheResults = true;
      continue;
    }
    if (arg === "--no-cache") {
      noCache = true;
      continue;
    }
    if (arg === "--profile") {
      profile = true;
      continue;
    }
    if (arg === "--base") {
      base = argv[++i] ?? base;
      baseExplicit = true;
      continue;
    }
    if (arg.startsWith("--base=")) {
      base = arg.split("=")[1] ?? base;
      baseExplicit = true;
      continue;
    }
    if (arg === "--timeout") {
      timeoutMs = parseTimeout(argv[++i]);
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutMs = parseTimeout(arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (fast && timeoutMs === DEFAULT_TEST_TIMEOUT_MS) {
    timeoutMs = FAST_TEST_TIMEOUT_MS;
  }

  return {
    dryRun,
    fast,
    staged,
    verbose,
    timeoutMs,
    changedOnly,
    base,
    baseExplicit,
    failFast,
    jsonSummary,
    skipTests,
    watch,
    watchTests,
    cacheResults,
    noCache,
    profile,
  };
}

async function runWithCache(options: CheckOptions): Promise<CheckRunResult> {
  if (options.cacheResults && !options.noCache) {
    const key = await computeCheckCacheKey(REPO_ROOT, options);
    if (key) {
      const cached = await loadCheckCache(REPO_ROOT, key);
      if (cached?.passed) return cached;
    }
  }

  const result = await runCheckPipeline(REPO_ROOT, options);

  if (options.cacheResults && !options.dryRun && shouldPersistCheckCache(result)) {
    const key = await computeCheckCacheKey(REPO_ROOT, options);
    if (key) await saveCheckCache(REPO_ROOT, key, result);
  }

  return result;
}

async function main() {
  ensureQuietEnv();
  const options = parseCli();

  if (options.dryRun && options.watch) {
    if (options.watchTests) printWatchTestsDryRun();
    else printWatchDryRun();
    const { steps, changedFiles, baseLabel } = await prepareDryRunSteps(REPO_ROOT, options);
    printCheckDryRun(options, steps, changedFiles, baseLabel);
    return;
  }

  if (options.dryRun) {
    const { steps, changedFiles, baseLabel } = await prepareDryRunSteps(REPO_ROOT, options);
    printCheckDryRun(options, steps, changedFiles, baseLabel);
    return;
  }

  if (options.watch) {
    const run = options.watchTests
      ? (opts: CheckOptions) => runTestOnlyPipeline(REPO_ROOT, opts)
      : runWithCache;
    const cleanup = startCheckWatchMode(REPO_ROOT, options, run);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    await new Promise(() => {});
    return;
  }

  const result = await runWithCache(options);
  printCheckResult(result, options);
  if (!result.passed) process.exit(1);
}

main().catch((err) => {
  console.error("check failed:", err.message);
  process.exit(1);
});
