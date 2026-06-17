#!/usr/bin/env bun
/**
 * Test runner — single source for package.json test scripts.
 *
 * Usage:
 *   bun run scripts/run-tests.ts
 *   bun run scripts/run-tests.ts --fast
 *   bun run scripts/run-tests.ts --coverage
 *   bun run scripts/run-tests.ts --ci --coverage
 *
 * Set KIMI_QUIET=1 for dots reporter + summary line on success.
 *
 * Stale coverage: if governance coverage fails after interrupted runs, clear
 * orphaned temp files before re-running: `rm -f coverage/*.tmp`
 *
 * @see https://bun.com/docs/guides/test/bail
 */

import { join } from "path";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { makeDir, pathExists } from "../src/lib/bun-io.ts";
import { bunTestArgs } from "../src/lib/test-gates.ts";
import { withBunNoOrphans } from "../src/lib/tool-runner.ts";
import { formatTestSummaryLine } from "../src/lib/gate-runner.ts";
import { ensureQuietEnv, isQuietMode } from "../src/lib/quiet-mode.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const BUNFIG_PATH = join(REPO_ROOT, "bunfig.toml");
const COVERAGE_FALSE = /^coverage = false\s*$/m;

/**
 * Bun 1.4 canary ignores `--coverage` when bunfig sets `coverage = false`.
 * Temporarily flip the flag for opt-in coverage runs, then restore.
 */
async function withCoverageBunfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();

  const original = await Bun.file(BUNFIG_PATH).text();
  const shouldPatch = COVERAGE_FALSE.test(original);
  if (shouldPatch) {
    await Bun.write(BUNFIG_PATH, original.replace(COVERAGE_FALSE, "coverage = true"));
  }
  try {
    return await fn();
  } finally {
    if (shouldPatch) await Bun.write(BUNFIG_PATH, original);
  }
}

function parseCli(): { fast: boolean; coverage: boolean; ci: boolean; smoke: boolean } {
  const argv = Bun.argv.slice(2);
  return {
    fast: argv.includes("--fast"),
    coverage: argv.includes("--coverage"),
    ci: argv.includes("--ci"),
    smoke: argv.includes("--smoke"),
  };
}

async function main() {
  ensureQuietEnv();
  const { fast, coverage, ci, smoke } = parseCli();
  const quiet = isQuietMode() && !ci;

  if (ci) {
    const reportsDir = join(REPO_ROOT, "reports");
    if (!pathExists(reportsDir)) makeDir(reportsDir, { recursive: true });
  }

  const exitCode = await withCoverageBunfig(coverage, async () => {
    const cmd = withBunNoOrphans([
      "bun",
      ...bunTestArgs({
        fast,
        coverage,
        ci,
        smoke,
        bail: true,
        retry: 2,
        dots: quiet,
      }),
    ]);

    if (!quiet) {
      const proc = Bun.spawn(cmd, {
        cwd: REPO_ROOT,
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      });
      return proc.exited;
    }

    const proc = Bun.spawn(cmd, {
      cwd: REPO_ROOT,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      readableStreamToText(proc.stdout),
      readableStreamToText(proc.stderr),
      proc.exited,
    ]);

    if (code !== 0) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      return code;
    }

    const summary = formatTestSummaryLine(`${stdout}\n${stderr}`);
    if (summary) console.log(summary);
    return code;
  });

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("run-tests failed:", err.message);
  process.exit(1);
});
