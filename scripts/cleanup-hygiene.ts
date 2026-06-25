#!/usr/bin/env bun
/**
 * cleanup:hygiene — unified path/root/artifacts cleanup (console boundary).
 */

import { pathExists } from "../src/lib/bun-io.ts";
import { GENERATED_ARTIFACTS_DIR } from "../src/lib/artifacts.ts";
import {
  executeHygieneCleanup,
  hygieneCleanupJsonPayload,
  hygieneExitCode,
  summarizeHygieneOutcome,
  type DeepHygieneExtras,
  type HygieneCleanupOutcome,
} from "../src/lib/cleanup-hygiene.ts";
import type { PathHygieneItem } from "../src/lib/path-hygiene.ts";
import { formatHygieneBytes } from "../src/lib/hygiene-utils.ts";
import type { PathHygieneReport } from "../src/lib/path-hygiene.ts";
import { scrubProcessBunInstallCacheEnv, type RootHygieneReport } from "../src/lib/root-hygiene.ts";

scrubProcessBunInstallCacheEnv();

function renderPathText(report: PathHygieneReport): void {
  if (report.misconfig.length > 0) {
    console.log("Cache misconfig (fix to prevent recurrence):");
    for (const hint of report.misconfig) console.log(`  • ${hint}`);
    console.log("");
  }

  if (report.items.length === 0) {
    console.log(`Path is clean — no hygiene artifacts under ${report.scanRoot}`);
    return;
  }

  console.log(
    report.dryRun
      ? `Would remove ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatHygieneBytes(report.totalBytes)}):`
      : `Removing ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatHygieneBytes(report.totalBytes)}):`
  );
  for (const item of report.items) {
    console.log(
      `  ${item.kind.padEnd(20)} ${item.relPath} — ${item.fileCount} file(s), ${formatHygieneBytes(item.bytes)}`
    );
    console.log(`    ${item.cause}`);
  }

  if (report.repoRootHygiene && report.repoRootHygiene.items.length > 0) {
    console.log(
      `\nAlso ${report.repoRootHygiene.items.length} repo-root artifact(s) (run cleanup:root or cleanup:all)`
    );
  }
}

function renderRootText(report: RootHygieneReport, bunfigFixed = false): void {
  if (bunfigFixed) console.log("Patched bunfig.toml — removed literal-tilde [install.cache].dir\n");

  if (report.items.length === 0 && report.misconfig.length === 0) {
    console.log("Root is clean — no bloat artifacts found.");
    return;
  }

  if (report.misconfig.length > 0) {
    console.log("Cache misconfig (fix to prevent recurrence):");
    for (const hint of report.misconfig) console.log(`  • ${hint}`);
    console.log("");
  }

  if (report.items.length === 0) {
    console.log("No removable root artifacts (misconfig may still apply).");
    return;
  }

  console.log(
    report.dryRun
      ? `Would remove ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatHygieneBytes(report.totalBytes)}):`
      : `Removing ${report.items.length} item(s), ${report.totalFiles} file(s) (${formatHygieneBytes(report.totalBytes)}):`
  );
  for (const item of report.items) {
    console.log(
      `  ${item.kind.padEnd(18)} ${item.relPath} — ${item.fileCount} file(s), ${formatHygieneBytes(item.bytes)}`
    );
    console.log(`    ${item.cause}`);
  }
}

function renderArtifactsText(
  outcome: Extract<HygieneCleanupOutcome, { type: "artifacts" | "all" }>
): void {
  const result = outcome.type === "artifacts" ? outcome.result : outcome.artifacts;
  const dryRun = outcome.dryRun;

  if (result.entries.length === 0) {
    console.log(
      !pathExists(result.artifactsDir)
        ? `${GENERATED_ARTIFACTS_DIR}/ not present — nothing to clean`
        : `${GENERATED_ARTIFACTS_DIR}/ is empty`
    );
    return;
  }

  if (dryRun) {
    console.log(`Would remove ${result.entries.length} item(s) under ${result.artifactsDir}/`);
    for (const entry of result.entries) console.log(`  ${entry}`);
  } else {
    console.log(`Removed ${result.removed} item(s) from ${GENERATED_ARTIFACTS_DIR}/`);
  }
}

function printHelp(): void {
  console.log(`cleanup:hygiene — unified path, repo-root, and artifact cleanup

Usage (from repo):
  bun run cleanup:path [--dry-run] [--json] [--path <dir>]
  bun run cleanup:root [--dry-run] [--json] [--fix-bunfig] [--root <path>]
  bun run cleanup:all  [--dry-run] [--json] [--fix] [--path <dir>] [--root <path>]
  bun run cleanup:artifacts [--dry-run] [--root <path>]

From anywhere (after bun run install-wrappers):
  cleanup-hygiene all --deep --dry-run
  cleanup-hygiene all --deep --fix --path ~

Exit code: 1 when removable items or cache misconfig remain (0 when clean).

Modes:
  path       Scan $HOME (or --path) for literal ~/ dirs and test-bun* junk
  root       Remove gitignored clutter at repo root
  all        path + root + artifacts in one pass
  artifacts  Purge .kimi-artifacts/ under repo root

Deep (--deep):
  max-depth 12; scans $HOME, Projects, .codex, .grok when no --path
  node_modules ~/ purge on repo root; ephemeral bun-node-* tmp cleanup
  advisory inventory for worktrees / archive / experimental (never auto-deleted)

Fix:
  --fix / --fix-bunfig   Patch bunfig.toml literal-tilde [install.cache].dir (root/all)`);
}

function renderNodeModulesTilde(items: PathHygieneItem[], dryRun: boolean): void {
  if (items.length === 0) return;
  console.log(
    dryRun
      ? `\nWould remove ${items.length} node_modules ~/ dir(s):`
      : `\nRemoved ${items.length} node_modules ~/ dir(s):`
  );
  for (const item of items) {
    console.log(`  ${item.relPath} — ${item.fileCount} file(s), ${formatHygieneBytes(item.bytes)}`);
  }
}

function renderDeepInventory(deep: DeepHygieneExtras, dryRun: boolean): void {
  if (deep.ephemeralBunNodesRemoved > 0) {
    console.log(`\nRemoved ${deep.ephemeralBunNodesRemoved} ephemeral bun-node-* dir(s) in tmp`);
  }
  if (deep.deepInventory.length === 0) return;
  console.log("\n══ Advisory (manual review — not auto-deleted) ══");
  for (const entry of deep.deepInventory) {
    console.log(`  ${entry.kind.padEnd(16)} ${entry.relPath} — ${formatHygieneBytes(entry.bytes)}`);
    console.log(`    ${entry.advisory}`);
  }
  if (dryRun) console.log("  (inventory only; pass without --dry-run to clean auto targets)");
}

function renderDeepExtras(deep: DeepHygieneExtras | undefined, dryRun: boolean): void {
  if (!deep) return;
  renderNodeModulesTilde(deep.nodeModulesTilde, dryRun);
  renderDeepInventory(deep, dryRun);
}

function renderSummary(outcome: HygieneCleanupOutcome): void {
  const summary = summarizeHygieneOutcome(outcome);
  if (!summary) return;

  if (!summary.dirty) {
    console.log("\nSummary: clean — no hygiene action needed");
    return;
  }

  const parts = [
    `${summary.itemGroups} group(s)`,
    `${summary.files} file(s)`,
    summary.bytes > 0 ? formatHygieneBytes(summary.bytes) : null,
  ].filter(Boolean);
  const misconfig =
    summary.misconfigHints > 0 ? `, ${summary.misconfigHints} cache misconfig hint(s)` : "";
  const fixed = summary.bunfigFixed ? ", bunfig patched" : "";
  console.log(`\nSummary: ${parts.join(", ")}${misconfig}${fixed}`);
}

function renderText(outcome: HygieneCleanupOutcome): void {
  if (outcome.type === "help") return;

  if (outcome.json) {
    console.log(JSON.stringify(hygieneCleanupJsonPayload(outcome), null, 2));
    return;
  }

  switch (outcome.type) {
    case "path":
      for (const report of outcome.reports) {
        if (outcome.reports.length > 1) console.log(`\n── ${report.scanRoot} ──`);
        renderPathText(report);
      }
      renderDeepExtras(outcome.deep, outcome.dryRun);
      break;
    case "root":
      renderRootText(outcome.report, outcome.bunfigFixed);
      break;
    case "artifacts":
      renderArtifactsText(outcome);
      break;
    case "all":
      console.log("══ Path scan ══");
      for (const report of outcome.pathReports) {
        if (outcome.pathReports.length > 1) console.log(`\n── ${report.scanRoot} ──`);
        renderPathText(report);
      }
      console.log("\n══ Repo root ══");
      renderRootText(outcome.rootReport, outcome.bunfigFixed);
      console.log("\n══ Artifacts ══");
      renderArtifactsText(outcome);
      renderDeepExtras(outcome.deep, outcome.dryRun);
      break;
  }
}

async function main(): Promise<number> {
  const outcome = await executeHygieneCleanup(Bun.argv.slice(2));
  if (outcome.type === "help") {
    printHelp();
    return 0;
  }
  renderText(outcome);
  if (!outcome.json) renderSummary(outcome);
  return hygieneExitCode(outcome);
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
