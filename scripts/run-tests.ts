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
 * @see https://bun.com/docs/guides/test/bail
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { bunTestArgs } from "../src/lib/test-gates.ts";
import { formatTestSummaryLine } from "../src/lib/gate-runner.ts";
import { ensureQuietEnv, isQuietMode } from "../src/lib/quiet-mode.ts";

const REPO_ROOT = join(import.meta.dir, "..");

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
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  }

  const cmd = [
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
  ];

  if (!quiet) {
    const proc = Bun.spawn(cmd, {
      cwd: REPO_ROOT,
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await proc.exited);
  }

  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  }

  const summary = formatTestSummaryLine(`${stdout}\n${stderr}`);
  if (summary) console.log(summary);
}

main().catch((err) => {
  console.error("run-tests failed:", err.message);
  process.exit(1);
});
