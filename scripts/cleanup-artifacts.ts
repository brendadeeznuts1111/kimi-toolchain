#!/usr/bin/env bun
/**
 * cleanup:artifacts — Remove generated files under .kimi-artifacts/.
 *
 * Usage:
 *   bun run cleanup:artifacts
 *   bun run cleanup:artifacts -- --dry-run
 */

import { join, resolve } from "path";
import { listDir, pathExists, removePath } from "../src/lib/bun-io.ts";
import { GENERATED_ARTIFACTS_DIR } from "../src/lib/artifacts.ts";
import { resolveEffectiveWorkspaceRoot } from "../src/lib/workspace-health.ts";

function parseArgs(argv: string[]): { dryRun: boolean; help: boolean; root?: string } {
  let dryRun = false;
  let help = false;
  let root: string | undefined;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    else if (!arg.startsWith("-")) root = arg;
  }

  return { dryRun, help, root };
}

async function main(): Promise<number> {
  const { dryRun, help, root } = parseArgs(Bun.argv.slice(2));
  if (help) {
    console.log(`cleanup:artifacts — purge ${GENERATED_ARTIFACTS_DIR}/

Usage:
  bun run cleanup:artifacts
  bun run cleanup:artifacts -- --dry-run [project-root]`);
    return 0;
  }

  const repoRoot = root
    ? resolve(root)
    : resolveEffectiveWorkspaceRoot(join(import.meta.dir, "..")).root;
  const artifactsDir = join(repoRoot, GENERATED_ARTIFACTS_DIR);
  if (!pathExists(artifactsDir)) {
    console.log(`${GENERATED_ARTIFACTS_DIR}/ not present — nothing to clean`);
    return 0;
  }

  const entries = listDir(artifactsDir);
  if (entries.length === 0) {
    console.log(`${GENERATED_ARTIFACTS_DIR}/ is empty`);
    return 0;
  }

  if (dryRun) {
    console.log(`Would remove ${entries.length} item(s) under ${artifactsDir}/`);
    for (const entry of entries) console.log(`  ${entry}`);
    return 0;
  }

  for (const entry of entries) {
    removePath(join(artifactsDir, entry));
  }

  console.log(`Removed ${entries.length} item(s) from ${GENERATED_ARTIFACTS_DIR}/`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
