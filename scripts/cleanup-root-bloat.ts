#!/usr/bin/env bun
/**
 * cleanup:root — Purge gitignored root clutter (literal ~/, profiles, cpuprofiles).
 *
 * Usage:
 *   bun run cleanup:root
 *   bun run cleanup:root:dry-run
 *   bun run cleanup:root -- --json
 *   kimi-toolchain cleanup root [--dry-run] [--json]
 */

import { join, resolve } from "path";
import {
  applyRootHygieneCleanup,
  auditRootHygiene,
  type RootHygieneReport,
} from "../src/lib/root-hygiene.ts";
import { resolveEffectiveWorkspaceRoot } from "../src/lib/workspace-health.ts";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  json: boolean;
  help: boolean;
  root?: string;
} {
  let dryRun = false;
  let json = false;
  let help = false;
  let root: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--root") root = argv[++i];
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }

  return { dryRun, json, help, root };
}

function resolveProjectRoot(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (Bun.env.KIMI_PROJECT_ROOT) return resolve(Bun.env.KIMI_PROJECT_ROOT);
  const { root } = resolveEffectiveWorkspaceRoot(join(import.meta.dir, ".."));
  return root;
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function printHelp(): void {
  console.log(`cleanup:root — remove gitignored artifacts at repo root

Usage:
  bun run cleanup:root
  bun run cleanup:root:dry-run
  kimi-toolchain cleanup root [--dry-run] [--json] [--root <path>]

Removes only known clutter at project root:
  ~/              literal tilde dir (Bun cache misconfig)
  profiles/       legacy profile output
  *.cpuprofile    CPU profiles left in cwd
  .tmp-*/         test temp dirs
  *.bak           backup files at root
  dx/             empty stub directory

Does not touch src/, test/, or tracked source files.

Fix recurring pollution:
  unset BUN_INSTALL_CACHE_DIR
  # or: export BUN_INSTALL_CACHE_DIR="$HOME/.bun/install/cache"
  # omit [install.cache].dir from bunfig.toml (Bun default is correct)`);
}

function renderText(report: RootHygieneReport): void {
  if (report.items.length === 0 && report.misconfig.length === 0) {
    console.log("Root is clean — no bloat artifacts found.");
    return;
  }

  if (report.misconfig.length > 0) {
    console.log("Cache misconfig (fix to prevent recurrence):");
    for (const hint of report.misconfig) {
      console.log(`  • ${hint}`);
    }
    console.log("");
  }

  if (report.items.length === 0) {
    console.log("No removable root artifacts (misconfig may still apply).");
    return;
  }

  console.log(
    report.dryRun
      ? `Would remove ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatBytes(report.totalBytes)}):`
      : `Removing ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatBytes(report.totalBytes)}):`
  );
  for (const item of report.items) {
    console.log(
      `  ${item.kind.padEnd(18)} ${item.relPath} — ${item.fileCount} file(s), ${formatBytes(item.bytes)}`
    );
    console.log(`    ${item.cause}`);
  }
}

async function main(): Promise<number> {
  const { dryRun, json, help, root } = parseArgs(Bun.argv.slice(2));
  if (help) {
    printHelp();
    return 0;
  }

  const projectRoot = resolveProjectRoot(root);
  const report = await auditRootHygiene(projectRoot, { dryRun });
  applyRootHygieneCleanup(report);

  if (json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          tool: "cleanup:root",
          projectRoot: report.projectRoot,
          dryRun: report.dryRun,
          count: report.items.length,
          totalFiles: report.totalFiles,
          totalBytes: report.totalBytes,
          misconfig: report.misconfig,
          items: report.items,
        },
        null,
        2
      )
    );
  } else {
    renderText(report);
  }

  return 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
