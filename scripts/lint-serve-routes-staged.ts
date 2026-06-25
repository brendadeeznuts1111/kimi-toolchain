#!/usr/bin/env bun
/**
 * Block new manual `if (path === ...)` dispatch in herdr-dashboard router.
 * Grandfathered lines in router.ts are exempt from full-file ast-grep via EXEMPT_FILES;
 * this gate only fails on staged additions.
 *
 * Usage: bun run scripts/lint-serve-routes-staged.ts
 */

import { $ } from "bun";

const ROUTER = "src/lib/herdr-dashboard/server/router.ts";

async function main(): Promise<void> {
  const diff = await $`git diff --cached -U0 -- ${ROUTER}`.quiet().nothrow();
  if (diff.exitCode !== 0) {
    console.error(`lint-serve-routes-staged: git diff failed (exit ${diff.exitCode})`);
    process.exit(diff.exitCode || 1);
  }

  const text = diff.stdout.toString();
  if (!text.trim()) {
    console.log("lint-serve-routes-staged: router.ts not staged — skip");
    process.exit(0);
  }

  const hits = text
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => /if\s*\(\s*path\s*===/.test(line));

  if (hits.length > 0) {
    console.error("New manual path dispatch in router.ts — use Bun.serve({ routes }) or URLPattern:");
    for (const line of hits) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log("lint-serve-routes-staged: 0 new if (path === violations");
}

await main();