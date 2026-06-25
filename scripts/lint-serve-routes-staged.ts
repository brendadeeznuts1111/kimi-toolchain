#!/usr/bin/env bun
/**
 * Block new manual path dispatch in herdr-dashboard router (staged additions only).
 * Grandfathered lines in router.ts are exempt from full-file ast-grep via EXEMPT_FILES;
 * ast-grep prefer-bun-serve-routes is warning-only — this gate is the hard block.
 *
 * Usage: bun run scripts/lint-serve-routes-staged.ts
 */

import { $ } from "bun";

const ROUTER = "src/lib/herdr-dashboard/server/router.ts";

/** Matches manual dispatch additions ast-grep also flags (===, startsWith, endsWith, includes). */
const MANUAL_DISPATCH =
  /^\+\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*path\s*(?:===|\.startsWith\s*\(|\.endsWith\s*\(|\.includes\s*\()/;

export function findManualDispatchAdditions(diffText: string): string[] {
  return diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => MANUAL_DISPATCH.test(line));
}

async function main(): Promise<void> {
  const diff = await $`git diff --cached -U0 -- ${ROUTER}`.quiet().nothrow();
  if (diff.exitCode !== 0) {
    const msg = diff.stderr.toString().trim() || diff.stdout.toString().trim();
    console.error(`lint-serve-routes-staged: git diff failed — ${msg || `exit ${diff.exitCode}`}`);
    process.exit(1);
  }

  const text = diff.stdout.toString();
  if (!text.trim()) {
    console.log("lint-serve-routes-staged: router.ts not staged — skip");
    process.exit(0);
  }

  const hits = findManualDispatchAdditions(text);
  if (hits.length > 0) {
    console.error(
      "New manual path dispatch in router.ts — use Bun.serve({ routes }) or URLPattern:",
    );
    for (const line of hits) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log("lint-serve-routes-staged: 0 new manual path dispatch violations");
}

if (import.meta.main) {
  await main();
}