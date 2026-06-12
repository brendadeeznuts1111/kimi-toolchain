/**
 * Workspace subcommands — verify | audit | fix | cleanup
 */

import { existsSync, lstatSync } from "fs";
import { join, resolve } from "path";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  fixWorkspaceHealth,
  CANONICAL_REPO_NAME,
  LEGACY_REPO_NAMES,
  listLegacyCursorSlugs,
  listActiveLegacyCursorSlugs,
  canonicalClonePath,
  legacyClonePath,
} from "./workspace-health.ts";
import { removeLegacyCursorSlugs, removeLegacySymlink } from "../bin/kimi-cleanup-legacy.ts";

export interface WorkspaceCommandFlags {
  json: boolean;
  strict: boolean;
  listCursor: boolean;
  removeCursor: boolean;
  removeLegacyPath: boolean;
  deep: boolean;
  archiveLegacySessions: boolean;
}

export function parseWorkspaceFlags(argv: string[]): WorkspaceCommandFlags {
  const deep =
    argv.includes("--deep") ||
    argv.includes("--fix-deep") ||
    argv.includes("--archive-legacy-sessions");
  return {
    json: argv.includes("--json"),
    strict: argv.includes("--strict") || argv.includes("--strict-workspace"),
    listCursor: argv.includes("--list-cursor-slugs"),
    removeCursor: argv.includes("--remove-cursor-slugs") || deep,
    removeLegacyPath: argv.includes("--remove-legacy-path") || deep,
    deep,
    archiveLegacySessions: argv.includes("--archive-legacy-sessions") || deep,
  };
}

export function printWorkspaceHelp(): void {
  console.log("Usage: kimi-doctor workspace <verify|audit|fix|cleanup> [options]");
  console.log("       kimi-toolchain workspace <verify|audit|fix|cleanup> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --json                 JSON output (audit)");
  console.log("  --strict               Treat soft warnings as errors");
  console.log("  --list-cursor-slugs    List legacy Cursor project folders");
  console.log("  --remove-cursor-slugs      Delete legacy Cursor slugs (opt-in)");
  console.log("  --remove-legacy-path       Remove ~/kimicode-cli symlink if present");
  console.log("  --archive-legacy-sessions  Move wd_kimicode-cli_* to sessions/archive/");
  console.log("  --deep                     All fixes: cursor slugs + sessions + index prune");
}

async function runVerify(projectRoot: string, strict: boolean): Promise<number> {
  const home = Bun.env.HOME || "/tmp";
  const report = await auditWorkspaceHealth(projectRoot, { strictWorkspace: strict, home });

  console.log("── Workspace verify ─────────────────────────────────────────");
  console.log(`  Path: ${projectRoot}`);

  for (const check of report.checks) {
    if (!["package-name", "physical-folder", "repo-folder", "package-json"].includes(check.name)) {
      continue;
    }
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${check.message}`);
  }

  const { blocking } = countWorkspaceBlockers(report, { strictWorkspace: strict });
  if (blocking > 0) {
    console.log(`  ✗ ${blocking} workspace blocker(s)`);
    return 1;
  }

  if (report.isToolchainRepo) {
    console.log(`  ✓ Canonical repo (${CANONICAL_REPO_NAME}, package.json ok)`);
  }
  return 0;
}

async function runAudit(projectRoot: string, json: boolean, strict: boolean): Promise<number> {
  const home = Bun.env.HOME || "/tmp";
  const report = await auditWorkspaceHealth(projectRoot, { strictWorkspace: strict, home });
  const summary = countWorkspaceBlockers(report, { strictWorkspace: strict });

  if (json) {
    console.log(
      JSON.stringify(
        {
          checks: report.checks,
          summary: {
            blocking: summary.blocking,
            warnings: summary.warnings,
            errors: summary.errors,
            ok: summary.blocking === 0,
            strictWorkspace: strict,
          },
          legacyCursorSlugs: report.legacyCursorSlugs,
          isToolchainRepo: report.isToolchainRepo,
        },
        null,
        2
      )
    );
    return summary.blocking > 0 ? 1 : 0;
  }

  console.log("── Workspace health audit ───────────────────────────────────");
  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }
  console.log("");
  if (summary.blocking > 0) {
    console.log(`  ✗ ${summary.blocking} blocker(s), ${summary.warnings} warning(s)`);
    return 1;
  }
  console.log(`  ✓ No blockers (${summary.warnings} warning(s))`);
  return 0;
}

async function runFix(projectRoot: string, flags: WorkspaceCommandFlags): Promise<number> {
  const home = Bun.env.HOME || "/tmp";
  const report = await auditWorkspaceHealth(projectRoot, { home });
  const result = await fixWorkspaceHealth(report, {
    projectRoot,
    home,
    removeCursorSlugs: flags.removeCursor,
    removeLegacySymlink: flags.removeLegacyPath,
    archiveLegacySessions: flags.archiveLegacySessions,
    pruneLegacySessionIndex: flags.deep || flags.archiveLegacySessions,
    syncDesktop: true,
    installWrappers: true,
  });

  console.log("── Workspace fix ────────────────────────────────────────────");
  if (result.staleWrappersRemoved > 0) {
    console.log(`  ✓ Removed ${result.staleWrappersRemoved} stale wrapper(s)`);
  }
  if (result.snapshotsRemoved > 0) {
    console.log(`  ✓ Removed ${result.snapshotsRemoved} orphaned snapshot(s)`);
  }
  if (result.syncRan) console.log("  ✓ Desktop sync completed");
  if (result.wrappersInstalled) console.log("  ✓ PATH wrappers installed");
  if (result.legacySymlinkRemoved) {
    console.log(`  ✓ Removed ~/${LEGACY_REPO_NAMES[0]} symlink`);
  }
  if (result.cursorSlugsRemoved.length > 0) {
    for (const slug of result.cursorSlugsRemoved) {
      console.log(`  ✓ Removed Cursor slug ${slug}`);
    }
    console.log(
      `  → Quit Cursor fully, then open ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
    );
  }
  if (result.sessionsArchived.length > 0) {
    console.log(`  ✓ Archived ${result.sessionsArchived.length} legacy Kimi session folder(s)`);
  }
  if (result.sessionIndexLinesPruned > 0) {
    console.log(`  ✓ Pruned ${result.sessionIndexLinesPruned} legacy session_index line(s)`);
  }

  const after = await auditWorkspaceHealth(projectRoot, { home });
  const { blocking } = countWorkspaceBlockers(after);
  return blocking > 0 ? 1 : 0;
}

async function runCleanup(
  projectRoot: string,
  listCursor: boolean,
  removeCursor: boolean,
  removeLegacyPath: boolean
): Promise<number> {
  const home = Bun.env.HOME || "/tmp";
  console.log("── Legacy workspace cleanup ───────────────────────────────────");

  const legacyPath = legacyClonePath(home);
  if (existsSync(legacyPath)) {
    try {
      const stat = lstatSync(legacyPath);
      if (stat.isSymbolicLink()) {
        console.log(`  ⚠ ~/${LEGACY_REPO_NAMES[0]} symlink exists`);
        if (removeLegacyPath && removeLegacySymlink(home)) {
          console.log(`  ✓ Removed symlink ~/${LEGACY_REPO_NAMES[0]}`);
        }
      } else if (stat.isDirectory()) {
        console.log(
          `  ⚠ ~/${LEGACY_REPO_NAMES[0]} directory exists — remove manually if duplicate`
        );
      }
    } catch {
      console.log(`  ⚠ ~/${LEGACY_REPO_NAMES[0]} exists`);
    }
  } else {
    console.log(`  ✓ No ~/${LEGACY_REPO_NAMES[0]} on disk`);
  }

  const canonical = canonicalClonePath(home);
  if (existsSync(join(canonical, "package.json"))) {
    console.log(`  ✓ ~/${CANONICAL_REPO_NAME} present`);
  } else {
    console.log(`  ✗ ~/${CANONICAL_REPO_NAME}/package.json missing`);
  }

  const slugs = listLegacyCursorSlugs(home);
  if (slugs.length === 0) {
    console.log("  ✓ No legacy Cursor project slugs");
  } else {
    if (listCursor || removeCursor) {
      for (const slug of slugs) {
        console.log(`      ${join(home, ".cursor", "projects", slug)}`);
      }
    } else {
      const active = listActiveLegacyCursorSlugs(home);
      console.log(`  ⚠ Legacy Cursor project slug(s): ${slugs.join(", ")}`);
      if (active.length > 0) {
        console.log(`      ACTIVE (agent session open): ${active.join(", ")}`);
      }
      console.log("      Run: kimi-toolchain workspace fix --deep");
    }
    if (removeCursor) {
      const removed = removeLegacyCursorSlugs(home);
      for (const slug of removed) {
        console.log(`  ✓ Removed ${slug}`);
      }
      console.log(
        `  → Restart Cursor and open ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
      );
    }
  }

  const report = await auditWorkspaceHealth(projectRoot, { home });
  if (report.legacySessionWorkspaces.length > 0) {
    console.log(`  ⚠ Legacy kimi session folder(s): ${report.legacySessionWorkspaces.join(", ")}`);
  } else {
    console.log("  ✓ No legacy-named kimi session folders");
  }

  console.log("");
  const verifyCode = await runVerify(projectRoot, false);
  if (slugs.length > 0 && !removeCursor) {
    console.log("");
    console.log("Next steps:");
    console.log(`  1. File → Open Folder → ~/${CANONICAL_REPO_NAME}`);
    console.log(
      `     Or: File → Open Workspace → ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
    );
    console.log(`  2. Close any window rooted at ~/${LEGACY_REPO_NAMES[0]}`);
    console.log("  3. Optional: kimi-toolchain workspace fix --deep");
  }
  return verifyCode;
}

export async function runWorkspaceCommand(
  command: string,
  argv: string[],
  projectRoot?: string
): Promise<number> {
  const root = projectRoot
    ? resolve(projectRoot)
    : process.env.KIMI_PROJECT_ROOT
      ? resolve(process.env.KIMI_PROJECT_ROOT)
      : resolve(join(import.meta.dir, "../.."));

  const flags = parseWorkspaceFlags(argv);

  switch (command) {
    case "verify":
      return runVerify(root, flags.strict);
    case "audit":
      return runAudit(root, flags.json, flags.strict);
    case "fix":
      return runFix(root, flags);
    case "cleanup":
      return runCleanup(root, flags.listCursor, flags.removeCursor, flags.removeLegacyPath);
    default:
      console.error(`Unknown workspace command: ${command}`);
      return 1;
  }
}
