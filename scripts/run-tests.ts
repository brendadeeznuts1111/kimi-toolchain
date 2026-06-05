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
 * Note: Bun 1.3.14 has no `bun test --config=ci`; CI settings are explicit flags
 * plus bunfig.toml [test] defaults (concurrentTestGlob, coverageThreshold).
 *
 * @see https://bun.com/docs/guides/test/bail
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { bunTestArgs } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseCli(): { fast: boolean; coverage: boolean; ci: boolean } {
  const argv = Bun.argv.slice(2);
  return {
    fast: argv.includes("--fast"),
    coverage: argv.includes("--coverage"),
    ci: argv.includes("--ci"),
  };
}

async function main() {
  const { fast, coverage, ci } = parseCli();
  if (ci) {
    const reportsDir = join(REPO_ROOT, "reports");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  }
  const cmd = ["bun", ...bunTestArgs({ fast, coverage, ci, bail: true })];
  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

main().catch((err) => {
  console.error("run-tests failed:", err.message);
  process.exit(1);
});
