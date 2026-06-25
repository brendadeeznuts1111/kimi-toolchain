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

import { $ } from "bun";

const REPO_ROOT = `${import.meta.dir}/..`;

async function main(): Promise<number> {
  const result = await $`bun run scripts/bun-hygiene-scan.ts`.cwd(REPO_ROOT).nothrow().quiet();

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const count = Number.parseInt(stdout.match(/bun-hygiene — (\d+) finding/)?.[1] ?? "0", 10);
  console.log(`[bun-hygiene] ${count} warnings (reporting only)`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
