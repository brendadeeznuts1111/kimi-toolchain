#!/usr/bin/env bun
/**
 * Quality gate runner.
 *
 * Usage:
 *   bun run scripts/check.ts
 *   bun run scripts/check.ts --fast
 *   bun run scripts/check.ts --fast --skip-tests
 *   bun run scripts/check.ts --changed-only
 *   bun run scripts/check.ts --staged
 *   bun run scripts/check.ts --watch
 *   bun run scripts/check.ts --watch-tests
 *   bun run scripts/check.ts --dry-run
 */

import { join } from "path";
import {
  printCheckResult,
  runCheckPipeline,
  runTestOnlyPipeline,
} from "../src/lib/check-pipeline.ts";
import { startCheckWatchMode } from "./check-watch-runner.ts";
import type { CheckOptions } from "../src/lib/check-types.ts";
import {
  gateSpawnEnv,
  scrubEphemeralBunNodeDirs,
  scrubProcessBunInstallCacheEnv,
} from "../src/lib/root-hygiene.ts";

scrubEphemeralBunNodeDirs();
scrubProcessBunInstallCacheEnv();
Object.assign(Bun.env, gateSpawnEnv(Bun.env));

const REPO_ROOT = join(import.meta.dir, "..");

function parseCli(): CheckOptions {
  const argv = Bun.argv.slice(2);
  const options: CheckOptions = {
    dryRun: false,
    fast: false,
    staged: false,
    verbose: false,
    timeoutMs: 0,
    changedOnly: false,
    base: "",
    baseExplicit: false,
    failFast: false,
    jsonSummary: false,
    skipTests: false,
    watch: false,
    watchTests: false,
    cacheResults: false,
    noCache: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--dry-run":
      case "--dryrun":
        options.dryRun = true;
        break;
      case "--fast":
        options.fast = true;
        break;
      case "--skip-tests":
        options.skipTests = true;
        break;
      case "--staged":
        options.staged = true;
        options.changedOnly = true;
        break;
      case "--changed-only":
        options.changedOnly = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--fail-fast":
        options.failFast = true;
        break;
      case "--json-summary":
        options.jsonSummary = true;
        break;
      case "--watch":
        options.watch = true;
        break;
      case "--watch-tests":
        options.watchTests = true;
        break;
      case "--cache-results":
        options.cacheResults = true;
        break;
      case "--no-cache":
        options.noCache = true;
        break;
      case "--base":
        options.base = argv[++i] ?? "";
        options.baseExplicit = true;
        break;
      case "--timeout":
        options.timeoutMs = parseInt(argv[++i] ?? "", 10);
        break;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      options.baseExplicit = true;
    }
  }

  return options;
}

async function runOnce(options: CheckOptions): Promise<number> {
  if (options.watchTests) {
    const result = await runTestOnlyPipeline(REPO_ROOT, options);
    if (!options.dryRun || options.jsonSummary) printCheckResult(result, options);
    return result.passed ? 0 : 1;
  }
  const result = await runCheckPipeline(REPO_ROOT, options);
  if (!options.dryRun || options.jsonSummary) printCheckResult(result, options);
  return result.passed ? 0 : 1;
}

async function main() {
  const options = parseCli();

  if (options.watch || options.watchTests) {
    const stop = startCheckWatchMode(REPO_ROOT, options, async (watchOptions) => {
      const code = await runOnce(watchOptions);
      return {
        passed: code === 0,
        steps: {},
        failures: [],
        totalDurationMs: 0,
      };
    });
    process.on("SIGINT", () => {
      stop();
      process.exit(0);
    });
    return;
  }

  process.exit(await runOnce(options));
}

main().catch((err) => {
  console.error("check failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
