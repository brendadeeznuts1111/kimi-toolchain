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
  type HygieneCleanupOutcome,
} from "../src/lib/cleanup-hygiene.ts";
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
  cleanup-hygiene all --dry-run --path ~
  kimi-toolchain cleanup all --dry-run --path ~  (requires synced .kimi-code tools)

Exit code: 1 when removable items or cache misconfig remain (0 when clean).

Modes:
  path       Scan $HOME (or --path) for literal ~/ dirs and test-bun* junk
  root       Remove gitignored clutter at repo root
  all        path + root + artifacts in one pass
  artifacts  Purge .kimi-artifacts/ under repo root

Fix:
  --fix / --fix-bunfig   Patch bunfig.toml literal-tilde [install.cache].dir (root/all)`);
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
