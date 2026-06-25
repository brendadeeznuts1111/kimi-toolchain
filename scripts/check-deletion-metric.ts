#!/usr/bin/env bun
/**
 * Deletion metric gate — enforces Lines-deleted/Lines-added ≥ 3.
 * Run: bun run check:deletion-metric [--staged]
 */

const staged = Bun.argv.includes("--staged");
const args = staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat", "HEAD~1"];

const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
const output = proc.stdout.toString();

const match = output.match(/(\d+) insertion.*?(\d+) deletion/);
if (!match) {
  console.log("[DELETION-METRIC] No changes to measure.");
  process.exit(0);
}

const added = Number(match[1]);
const deleted = Number(match[2]);
const ratio = added > 0 ? deleted / added : Infinity;

if (ratio >= 3) {
  console.log(
    `[DELETION-METRIC] PASS: ${added} additions, ${deleted} deletions (ratio ${ratio.toFixed(1)}x, need 3.0x)`
  );
  process.exit(0);
}

console.error(
  `[DELETION-METRIC] FAIL: ${added} additions, ${deleted} deletions (ratio ${ratio.toFixed(1)}x, need 3.0x)`
);
process.exit(1);
