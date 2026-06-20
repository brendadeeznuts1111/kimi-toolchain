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
  listActiveLegacyCursorSlugs,
  canonicalClonePath,
  legacyClonePath,
} from "./workspace-health.ts";
import {
  removeLegacyCursorSlugs,
  removeLegacySymlink,
  listLegacyCursorSlugs,
} from "./legacy-cleanup.ts";
import { createLogger, type Logger } from "./logger.ts";
import { writeStdoutLine } from "./cli-contract.ts";
import { homeDir } from "./paths.ts";

export interface WorkspaceCommandFlags {
  json: boolean;
  strict: boolean;
  listCursor: boolean;
  removeCursor: boolean;
  removeLegacyPath: boolean;
  deep: boolean;
  archiveLegacySessions: boolean;
}

function resolveLogger(logger?: Logger): Logger {
  return logger ?? createLogger(Bun.argv, "workspace");
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

export function printWorkspaceHelp(logger?: Logger): void {
  const log = resolveLogger(logger);
  log.line("Usage: kimi-doctor workspace <verify|audit|fix|cleanup> [options]");
  log.line("       kimi-toolchain workspace <verify|audit|fix|cleanup> [options]");
  log.line("");
  log.line("Options:");
  log.line("  --json                 JSON output (audit)");
  log.line("  --strict               Treat soft warnings as errors");
  log.line("  --list-cursor-slugs    List legacy Cursor project folders");
  log.line("  --remove-cursor-slugs      Delete legacy Cursor slugs (opt-in)");
  log.line("  --remove-legacy-path       Remove ~/kimicode-cli symlink if present");
  log.line("  --archive-legacy-sessions  Move wd_kimicode-cli_* to sessions/archive/");
  log.line("  --deep                     All fixes: cursor slugs + sessions + index prune");
}

async function runVerify(projectRoot: string, strict: boolean, logger: Logger): Promise<number> {
  const home = homeDir();
  const report = await auditWorkspaceHealth(projectRoot, { strictWorkspace: strict, home });

  logger.section("Workspace verify");
  logger.line(`  Path: ${projectRoot}`);

  for (const check of report.checks) {
    if (!["package-name", "physical-folder", "repo-folder", "package-json"].includes(check.name)) {
      continue;
    }
    if (check.status === "error") logger.error(check.message);
    else if (check.status === "warn") logger.warn(check.message);
    else logger.info(check.message);
  }

  const { blocking } = countWorkspaceBlockers(report, { strictWorkspace: strict });
  if (blocking > 0) {
    logger.error(`${blocking} workspace blocker(s)`);
    return 1;
  }

  if (report.isToolchainRepo) {
    logger.info(`Canonical repo (${CANONICAL_REPO_NAME}, package.json ok)`);
  }
  return 0;
}

async function runAudit(
  projectRoot: string,
  json: boolean,
  strict: boolean,
  logger: Logger
): Promise<number> {
  const home = homeDir();
  const report = await auditWorkspaceHealth(projectRoot, { strictWorkspace: strict, home });
  const summary = countWorkspaceBlockers(report, { strictWorkspace: strict });

  if (json) {
    await writeStdoutLine(
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

  logger.section("Workspace health audit");
  for (const check of report.checks) {
    const label = `${check.name}: ${check.message}`;
    if (check.status === "error") logger.error(label);
    else if (check.status === "warn") logger.warn(label);
    else logger.info(label);
  }
  logger.line("");
  if (summary.blocking > 0) {
    logger.error(`${summary.blocking} blocker(s), ${summary.warnings} warning(s)`);
    return 1;
  }
  logger.info(`No blockers (${summary.warnings} warning(s))`);
  return 0;
}

async function runFix(
  projectRoot: string,
  flags: WorkspaceCommandFlags,
  logger: Logger
): Promise<number> {
  const home = homeDir();
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

  logger.section("Workspace fix");
  if (result.staleWrappersRemoved > 0) {
    logger.info(`Removed ${result.staleWrappersRemoved} stale wrapper(s)`);
  }
  if (result.snapshotsRemoved > 0) {
    logger.info(`Removed ${result.snapshotsRemoved} orphaned snapshot(s)`);
  }
  if (result.syncRan) logger.info("Desktop sync completed");
  if (result.wrappersInstalled) logger.info("PATH wrappers installed");
  if (result.legacySymlinkRemoved) {
    logger.info(`Removed ~/${LEGACY_REPO_NAMES[0]} symlink`);
  }
  if (result.cursorSlugsRemoved.length > 0) {
    for (const slug of result.cursorSlugsRemoved) {
      logger.info(`Removed Cursor slug ${slug}`);
    }
    logger.line(
      `  → Quit Cursor fully, then open ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
    );
  }
  if (result.sessionsArchived.length > 0) {
    logger.info(`Archived ${result.sessionsArchived.length} legacy Kimi session folder(s)`);
  }
  if (result.sessionIndexLinesPruned > 0) {
    logger.info(`Pruned ${result.sessionIndexLinesPruned} legacy session_index line(s)`);
  }

  const after = await auditWorkspaceHealth(projectRoot, { home });
  const { blocking } = countWorkspaceBlockers(after);
  return blocking > 0 ? 1 : 0;
}

async function runCleanup(
  projectRoot: string,
  listCursor: boolean,
  removeCursor: boolean,
  removeLegacyPath: boolean,
  logger: Logger
): Promise<number> {
  const home = homeDir();
  logger.section("Legacy workspace cleanup");

  const legacyPath = legacyClonePath(home);
  if (existsSync(legacyPath)) {
    try {
      const stat = lstatSync(legacyPath);
      if (stat.isSymbolicLink()) {
        logger.warn(`~/${LEGACY_REPO_NAMES[0]} symlink exists`);
        if (removeLegacyPath && removeLegacySymlink()) {
          logger.info(`Removed symlink ~/${LEGACY_REPO_NAMES[0]}`);
        }
      } else if (stat.isDirectory()) {
        logger.warn(`~/${LEGACY_REPO_NAMES[0]} directory exists — remove manually if duplicate`);
      }
    } catch {
      logger.warn(`~/${LEGACY_REPO_NAMES[0]} exists`);
    }
  } else {
    logger.info(`No ~/${LEGACY_REPO_NAMES[0]} on disk`);
  }

  const canonical = canonicalClonePath(home);
  if (existsSync(join(canonical, "package.json"))) {
    logger.info(`~/${CANONICAL_REPO_NAME} present`);
  } else {
    logger.error(`~/${CANONICAL_REPO_NAME}/package.json missing`);
  }

  const slugs = listLegacyCursorSlugs();
  if (slugs.length === 0) {
    logger.info("No legacy Cursor project slugs");
  } else {
    if (listCursor || removeCursor) {
      for (const slug of slugs) {
        logger.line(`      ${join(home, ".cursor", "projects", slug)}`);
      }
    } else {
      const active = listActiveLegacyCursorSlugs();
      logger.warn(`Legacy Cursor project slug(s): ${slugs.join(", ")}`);
      if (active.length > 0) {
        logger.line(`      ACTIVE (agent session open): ${active.join(", ")}`);
      }
      logger.line("      Run: kimi-toolchain workspace fix --deep");
    }
    if (removeCursor) {
      const removed = removeLegacyCursorSlugs();
      for (const slug of removed) {
        logger.info(`Removed ${slug}`);
      }
      logger.line(
        `  → Restart Cursor and open ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
      );
    }
  }

  const report = await auditWorkspaceHealth(projectRoot, { home });
  if (report.legacySessionWorkspaces.length > 0) {
    logger.warn(`Legacy kimi session folder(s): ${report.legacySessionWorkspaces.join(", ")}`);
  } else {
    logger.info("No legacy-named kimi session folders");
  }

  logger.line("");
  const verifyCode = await runVerify(projectRoot, false, logger);
  if (slugs.length > 0 && !removeCursor) {
    logger.line("");
    logger.line("Next steps:");
    logger.line(`  1. File → Open Folder → ~/${CANONICAL_REPO_NAME}`);
    logger.line(
      `     Or: File → Open Workspace → ~/${CANONICAL_REPO_NAME}/kimi-toolchain.code-workspace`
    );
    logger.line(`  2. Close any window rooted at ~/${LEGACY_REPO_NAMES[0]}`);
    logger.line("  3. Optional: kimi-toolchain workspace fix --deep");
  }
  return verifyCode;
}

function defaultWorkspaceRoot(): string {
  if (Bun.env.KIMI_PROJECT_ROOT) return resolve(Bun.env.KIMI_PROJECT_ROOT);
  const cwd = resolve(Bun.cwd);
  if (existsSync(join(cwd, "package.json"))) return cwd;
  return resolve(join(import.meta.dir, "../.."));
}

export async function runWorkspaceCommand(
  command: string,
  argv: string[],
  projectRoot?: string,
  logger?: Logger
): Promise<number> {
  const log = resolveLogger(logger);
  const root = projectRoot ? resolve(projectRoot) : defaultWorkspaceRoot();

  const flags = parseWorkspaceFlags(argv);

  switch (command) {
    case "verify":
      return runVerify(root, flags.strict, log);
    case "audit":
      return runAudit(root, flags.json, flags.strict, log);
    case "fix":
      return runFix(root, flags, log);
    case "cleanup":
      return runCleanup(root, flags.listCursor, flags.removeCursor, flags.removeLegacyPath, log);
    default:
      log.error(`Unknown workspace command: ${command}`);
      return 1;
  }
}
