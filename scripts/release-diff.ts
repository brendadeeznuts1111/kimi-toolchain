#!/usr/bin/env bun
/**
 * Release diff — compare any two versions in the release history.
 *
 *   bun run release:diff                          # current vs previous
 *   bun run release:diff -- --from 1.3.5 --to 1.3.7  # custom range
 *   bun run release:diff -- --list                   # list known versions
 *   bun run release:diff -- --json                   # JSON output
 */

import {
  BUN_RELEASE,
  BUN_RELEASE_PREVIOUS,
  computeReleaseDiff,
  computeReleaseDiffVersions,
  sortedReleaseVersions,
  type ReleaseDiff,
} from "../src/lib/bun-release-registry.ts";

function argValue(name: string): string | undefined {
  const idx = Bun.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < Bun.argv.length) return Bun.argv[idx + 1];
  return undefined;
}

const json = Bun.argv.includes("--json");
const list = Bun.argv.includes("--list");
const from = argValue("--from");
const to = argValue("--to");

function formatDiff(diff: ReleaseDiff): string {
  const { current, previous, breakingAdded, breakingRemoved, commitRangeUrl, publishedDeltaDays } =
    diff;

  const lines = [
    `${previous.version} → ${current.version}`,
    `  previous: ${previous.tag} @ ${previous.hash.slice(0, 12)} (${previous.blogPublished})`,
    `  current:  ${current.tag} @ ${current.hash.slice(0, 12)} (${current.blogPublished})`,
    `  delta:    ${publishedDeltaDays} days between releases`,
    `  commits:  ${commitRangeUrl}`,
  ];

  if (breakingAdded.length > 0) {
    lines.push(`  breaking added (${breakingAdded.length}):`);
    for (const item of breakingAdded) {
      lines.push(`    + ${item}`);
    }
  }
  if (breakingRemoved.length > 0) {
    lines.push(`  breaking removed (${breakingRemoved.length}):`);
    for (const item of breakingRemoved) {
      lines.push(`    − ${item}`);
    }
  }
  if (breakingAdded.length === 0 && breakingRemoved.length === 0) {
    lines.push(`  breaking: no changes`);
  }

  return lines.join("\n");
}

function main(): void {
  if (list) {
    console.log("Known versions:");
    for (const v of sortedReleaseVersions()) {
      const marker =
        v === BUN_RELEASE.version
          ? " ← current"
          : v === BUN_RELEASE_PREVIOUS.version
            ? " ← previous"
            : "";
      console.log(`  ${v}${marker}`);
    }
    return;
  }

  let diff: ReleaseDiff;
  try {
    diff =
      from || to
        ? computeReleaseDiffVersions(
            from ?? BUN_RELEASE_PREVIOUS.version,
            to ?? BUN_RELEASE.version
          )
        : computeReleaseDiff(BUN_RELEASE, BUN_RELEASE_PREVIOUS);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(formatDiff(diff));
}

if (import.meta.main) {
  main();
}
