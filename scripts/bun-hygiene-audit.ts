#!/usr/bin/env bun
/**
 * Bun hygiene audit — Phase 0 warn-only baseline (never fails).
 *
 * Reports warning count on every fast check without blocking commits.
 *
 * Usage:
 *   bun run scripts/bun-hygiene-audit.ts
 *   bun run bun-hygiene:audit
 */

import { join } from "path";
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

function extractWarningCount(stdout: string): number {
  const match = stdout.match(/bun-hygiene — (\d+) finding/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

async function main(): Promise<number> {
  const result = await $`bun run scripts/bun-hygiene-scan.ts`.cwd(REPO_ROOT).nothrow().quiet();

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const count = extractWarningCount(stdout);
  console.log(`[bun-hygiene] ${count} warnings (reporting only)`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
