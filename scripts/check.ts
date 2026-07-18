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
 *   bun run scripts/check.ts --dry-run
 */

import {
  printCheckResult,
  runCheckPipeline,
  runTestOnlyPipeline,
} from "../src/lib/check-pipeline.ts";
import type { CheckOptions } from "../src/lib/check-changed.ts";
import { acquireTestGateLock } from "../src/lib/test-run-guard.ts";
import {
  gateSpawnEnv,
  scrubEphemeralBunNodeDirs,
  scrubProcessBunInstallCacheEnv,
} from "../src/lib/root-hygiene.ts";

scrubEphemeralBunNodeDirs();
scrubProcessBunInstallCacheEnv();
Object.assign(Bun.env, gateSpawnEnv(Bun.env));

const REPO_ROOT = Bun.fileURLToPath(import.meta.resolve("./.."));

function parseCli(): CheckOptions {
  const argv = Bun.argv.slice(2);
  const options: CheckOptions = {
    dryRun: false,
    fast: false,
    staged: false,
    verbose: false,
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
  // Full-suite runs skip the recursive test:fast smoke test to avoid nesting
  // a long test runner inside itself under heavy load, and skip network probes
  // that flake under full-suite concurrency. The smoke test and network probes
  // still run in check:fast and direct invocations.
  if (options.fast) {
    delete Bun.env.KIMI_TEST_FULL_SUITE;
    delete Bun.env.KIMI_SKIP_NETWORK_PROBE;
  } else {
    Bun.env.KIMI_TEST_FULL_SUITE = "1";
    Bun.env.KIMI_SKIP_NETWORK_PROBE = "1";
  }

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
    console.error("check watch mode removed: Bun.watch is unavailable in this runtime");
    process.exit(1);
  }

  // Hold the project test gate for the whole run: concurrent gates racing on
  // shared state (ephemeral bun-node-* dirs, test-home artifacts) previously
  // spun each other into infinite loops instead of failing fast.
  const gateLock = options.dryRun
    ? null
    : acquireTestGateLock(REPO_ROOT, options.fast ? "check:fast" : "check");
  if (gateLock && !gateLock.ok) {
    console.error(gateLock.conflict.message);
    process.exit(1);
  }
  try {
    return await runOnce(options);
  } finally {
    gateLock?.lock.release();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("check failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
