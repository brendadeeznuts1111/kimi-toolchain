/**
 * Workspace health — single source of truth for repo/path/Cursor alignment.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, unlinkSync } from "fs";
import { basename, join, resolve } from "path";
import { readPackageJson, safeParse } from "./utils.ts";

import {
  archiveLegacyKimiSessions,
  pruneLegacySessionIndex,
  removeLegacyCursorSlugs,
  removeLegacySymlink,
  listLegacyCursorSlugs,
  isCursorSlugActive,
  listLegacySessionWorkspaces as listLegacySessionWorkspacesImported,
} from "./legacy-cleanup.ts";

export const CANONICAL_REPO_NAME = "kimi-toolchain";
export const LEGACY_REPO_NAMES = ["kimicode-cli", "kimi-code-cli"] as const;
export const WORKSPACE_BLOCKER_NAMES = new Set([
  "wrapper-coverage",
  "desktop-tools",
  "repo-folder",
  "cursor-workspace",
  "package-name",
  "physical-folder",
]);

/** Warn by default; become errors with --strict-workspace. */
export const WORKSPACE_SOFT_NAMES = new Set([
  "kimi-sessions",
  "session-cwd",
  "session-index",
  "snapshots",
]);

import type { HealthCheck, WorkspaceKnownContext } from "./health-check.ts";

export type WorkspaceCheck = HealthCheck;
export type { WorkspaceKnownContext };

export interface WorkspaceHealthReport {
  checks: WorkspaceCheck[];
  staleWrappers: string[];
  missingWrappers: string[];
  orphanedSnapshots: number;
  legacySessionWorkspaces: string[];
  legacyCursorSlugs: string[];
  isToolchainRepo: boolean;
  canonicalClonePresent: boolean;
}

export interface AuditWorkspaceOptions {
  home?: string;
  strictWorkspace?: boolean;
}

export interface FixWorkspaceOptions {
  home?: string;
  projectRoot: string;
  removeCursorSlugs?: boolean;
  removeLegacySymlink?: boolean;
  archiveLegacySessions?: boolean;
  pruneLegacySessionIndex?: boolean;
  syncDesktop?: boolean;
  installWrappers?: boolean;
}

export interface FixWorkspaceResult {
  staleWrappersRemoved: number;
  snapshotsRemoved: number;
  cursorSlugsRemoved: string[];
  legacySymlinkRemoved: boolean;
  sessionsArchived: string[];
  sessionIndexLinesPruned: number;
  syncRan: boolean;
  wrappersInstalled: boolean;
}

export async function getExpectedBinNames(repoRoot: string): Promise<string[]> {
  const pkg = await readPackageJson(
    repoRoot,
    (p): p is { bin?: Record<string, string> } => typeof p === "object" && p !== null && "bin" in p
  );
  return Object.keys(pkg?.bin || {}).sort();
}

export function listInstalledWrappers(binDir: string): string[] {
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .filter((f) => f.startsWith("kimi-") || f === "kimi-toolchain")
    .sort();
}

export async function listExpectedWrapperNames(repoRoot: string): Promise<string[]> {
  const { listExpectedWrapperNames: fromRegistry } = await import("./tool-registry.ts");
  return fromRegistry(repoRoot);
}

export async function listStaleWrappers(repoRoot: string, binDir: string): Promise<string[]> {
  const expected = new Set(await listExpectedWrapperNames(repoRoot));
  return listInstalledWrappers(binDir).filter((name) => !expected.has(name));
}

export async function listMissingWrappers(repoRoot: string, binDir: string): Promise<string[]> {
  const expected = await listExpectedWrapperNames(repoRoot);
  return expected.filter((name) => !existsSync(join(binDir, name)));
}

export function legacyClonePath(home: string): string {
  return join(home, LEGACY_REPO_NAMES[0]);
}

export function canonicalClonePath(home: string): string {
  return join(home, CANONICAL_REPO_NAME);
}

export function listActiveLegacyCursorSlugs(): string[] {
  return listLegacyCursorSlugs().filter((slug) => isCursorSlugActive(slug));
}

function countMismatchedSessionCwds(sessionIndexPath: string, expectedCwd: string): number {
  if (!existsSync(sessionIndexPath)) return 0;
  const expected = resolve(expectedCwd);
  let mismatched = 0;
  try {
    const lines = readFileSync(sessionIndexPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = safeParse(line, null as { cwd?: string; workDir?: string } | null);
      const cwd = entry?.cwd || entry?.workDir;
      if (cwd && resolve(cwd) !== expected) mismatched++;
    }
  } catch {
    return 0;
  }
  return mismatched;
}

function countOrphanedSnapshots(snapshotDir: string): number {
  if (!existsSync(snapshotDir)) return 0;
  let orphaned = 0;
  const glob = new Bun.Glob("*.json");
  for (const file of glob.scanSync({ cwd: snapshotDir, absolute: true })) {
    const snap = safeParse(readFileSync(file, "utf8"), null as { projectPath?: string } | null);
    if (snap?.projectPath && !existsSync(snap.projectPath)) orphaned++;
  }
  return orphaned;
}

export async function isKimiToolchainRepo(projectRoot: string): Promise<boolean> {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = (await Bun.file(pkgPath).json()) as { name?: string };
    return pkg.name === CANONICAL_REPO_NAME;
  } catch {
    return false;
  }
}

export async function auditWorkspaceHealth(
  projectRoot: string,
  options: AuditWorkspaceOptions = {}
): Promise<WorkspaceHealthReport> {
  const home = options.home ?? Bun.env.HOME ?? "/tmp";
  const strict = options.strictWorkspace ?? false;
  const binDir = join(home, ".local", "bin");
  const snapshotDir = join(home, ".kimi-code", "snapshots");
  const sessionsDir = join(home, ".kimi-code", "sessions");
  const checks: WorkspaceCheck[] = [];

  const resolvedRoot = resolve(projectRoot);
  const repoName = basename(resolvedRoot);
  let physicalName = repoName;
  try {
    physicalName = basename(realpathSync(resolvedRoot));
  } catch {
    /* keep repoName */
  }

  let pkgName = "unknown";
  const pkg = await readPackageJson(
    projectRoot,
    (p): p is { name?: string } => typeof p === "object" && p !== null && "name" in p
  );
  if (pkg) {
    pkgName = pkg.name || "unknown";
  } else {
    pkgName = "missing";
  }

  const isToolchain = pkgName === CANONICAL_REPO_NAME;
  const canonicalPath = canonicalClonePath(home);
  const canonicalClonePresent = existsSync(join(canonicalPath, "package.json"));
  const legacyCursorSlugs = listLegacyCursorSlugs(home);

  if (!existsSync(join(projectRoot, "package.json"))) {
    checks.push({
      name: "package-json",
      status: "error",
      message: "no package.json in project root",
      fixable: false,
    });
  } else if (isToolchain) {
    checks.push({
      name: "package-name",
      status: "ok",
      message: CANONICAL_REPO_NAME,
      fixable: false,
    });
  }

  if (isToolchain) {
    if (physicalName !== CANONICAL_REPO_NAME) {
      checks.push({
        name: "physical-folder",
        status: "error",
        message: `physical folder is '${physicalName}' — open ~/${CANONICAL_REPO_NAME} in Cursor`,
        fixable: false,
      });
    } else {
      checks.push({
        name: "physical-folder",
        status: "ok",
        message: `${CANONICAL_REPO_NAME}/`,
        fixable: false,
      });
    }

    if (repoName === CANONICAL_REPO_NAME) {
      checks.push({
        name: "repo-folder",
        status: "ok",
        message: `${CANONICAL_REPO_NAME}/ matches package name`,
        fixable: false,
      });
    } else if (physicalName === CANONICAL_REPO_NAME) {
      const status = strict ? "error" : "warn";
      checks.push({
        name: "repo-folder",
        status,
        message: `opened via ${repoName}/ — use ~/${CANONICAL_REPO_NAME} in Cursor (symlink/legacy path)`,
        fixable: false,
      });
    } else {
      checks.push({
        name: "repo-folder",
        status: "error",
        message: `folder is ${repoName}/ — rename to ${CANONICAL_REPO_NAME}/ for alignment`,
        fixable: false,
      });
    }
  }

  const legacyPath = legacyClonePath(home);
  if (existsSync(legacyPath)) {
    checks.push({
      name: "legacy-clone",
      status: "warn",
      message:
        resolvedRoot === legacyPath
          ? `repo still at ${LEGACY_REPO_NAMES[0]}/ — rename clone to ${CANONICAL_REPO_NAME}/`
          : `${legacyPath} still exists — use ${canonicalPath} only`,
      fixable: true,
    });
  } else {
    checks.push({
      name: "legacy-clone",
      status: "ok",
      message: `no ${LEGACY_REPO_NAMES[0]}/ clone path`,
      fixable: false,
    });
  }

  if (resolvedRoot === canonicalPath || repoName === CANONICAL_REPO_NAME) {
    checks.push({
      name: "canonical-clone",
      status: "ok",
      message: canonicalPath,
      fixable: false,
    });
  } else if (isToolchain) {
    checks.push({
      name: "canonical-clone",
      status: "warn",
      message: `toolchain repo not at ${canonicalPath}`,
      fixable: false,
    });
  }

  const staleWrappers = await listStaleWrappers(projectRoot, binDir);
  const missingWrappers = await listMissingWrappers(projectRoot, binDir);

  checks.push(
    staleWrappers.length === 0
      ? {
          name: "path-wrappers",
          status: "ok",
          message: "no stale ~/.local/bin/kimi-* wrappers",
          fixable: false,
        }
      : {
          name: "path-wrappers",
          status: "warn",
          message: `${staleWrappers.length} stale: ${staleWrappers.join(", ")}`,
          fixable: true,
        }
  );

  checks.push(
    missingWrappers.length === 0
      ? {
          name: "wrapper-coverage",
          status: "ok",
          message: "all package.json bin entries have wrappers",
          fixable: false,
        }
      : {
          name: "wrapper-coverage",
          status: "error",
          message: `${missingWrappers.length} missing: ${missingWrappers.join(", ")}`,
          fixable: true,
        }
  );

  const toolsDir = join(home, ".kimi-code", "tools");
  const expectedBins = await getExpectedBinNames(projectRoot);
  if (isToolchain && existsSync(toolsDir)) {
    const installedTools = readdirSync(toolsDir).filter((f) => f.endsWith(".ts")).length;
    checks.push(
      installedTools >= expectedBins.length
        ? {
            name: "desktop-tools",
            status: "ok",
            message: `${installedTools} tools in ~/.kimi-code/tools/`,
            fixable: false,
          }
        : {
            name: "desktop-tools",
            status: "error",
            message: `${installedTools}/${expectedBins.length} tools — run bun run sync`,
            fixable: true,
          }
    );
  } else if (isToolchain) {
    checks.push({
      name: "desktop-tools",
      status: "error",
      message: "no ~/.kimi-code/tools/ — run bun run sync",
      fixable: true,
    });
  }

  const orphanedSnapshots = countOrphanedSnapshots(snapshotDir);
  const snapshotStatus = orphanedSnapshots === 0 ? "ok" : strict ? "error" : "warn";
  checks.push(
    orphanedSnapshots === 0
      ? {
          name: "snapshots",
          status: "ok",
          message: "no orphaned snapshot paths",
          fixable: false,
        }
      : {
          name: "snapshots",
          status: snapshotStatus,
          message: `${orphanedSnapshots} snapshot(s) point to missing project paths`,
          fixable: true,
        }
  );

  const legacySessionWorkspaces = listLegacySessionWorkspacesImported(sessionsDir);
  const sessionStatus = legacySessionWorkspaces.length === 0 ? "ok" : strict ? "error" : "warn";
  checks.push(
    legacySessionWorkspaces.length === 0
      ? {
          name: "kimi-sessions",
          status: "ok",
          message: "no legacy Kimi Code workspace folders",
          fixable: false,
        }
      : {
          name: "kimi-sessions",
          status: sessionStatus,
          message: `${legacySessionWorkspaces.length} legacy wd_* folder(s) — open ${CANONICAL_REPO_NAME}/ for new sessions`,
          fixable: false,
        }
  );

  const sessionIndex = join(sessionsDir, "session_index.jsonl");
  if (isToolchain && existsSync(sessionIndex)) {
    const mismatched = countMismatchedSessionCwds(sessionIndex, canonicalPath);
    const cwdStatus = mismatched === 0 ? "ok" : strict ? "error" : "warn";
    checks.push(
      mismatched === 0
        ? {
            name: "session-cwd",
            status: "ok",
            message: `sessions bound to ${canonicalPath}`,
            fixable: false,
          }
        : {
            name: "session-cwd",
            status: cwdStatus,
            message: `${mismatched} session(s) from other cwd — use kimi --continue from ${CANONICAL_REPO_NAME}/`,
            fixable: false,
          }
    );
  }

  const kimiBin = Bun.which("kimi");
  const officialKimi = join(home, ".kimi-code", "bin", "kimi");
  if (kimiBin) {
    checks.push(
      kimiBin === officialKimi
        ? {
            name: "kimi-binary",
            status: "ok",
            message: officialKimi,
            fixable: false,
          }
        : {
            name: "kimi-binary",
            status: "warn",
            message: `${kimiBin} — expected ${officialKimi} for ACP/IDE configs`,
            fixable: false,
          }
    );
    checks.push({
      name: "acp-command",
      status: "ok",
      message: `IDE ACP: command "${kimiBin}", args ["acp"]`,
      fixable: false,
    });
  } else if (isToolchain) {
    checks.push({
      name: "kimi-binary",
      status: "error",
      message: "kimi not on PATH",
      fixable: false,
    });
  }

  if (legacyCursorSlugs.length > 0) {
    const slug = legacyCursorSlugs[0];
    const isBlocker = isToolchain && canonicalClonePresent;
    const active = isCursorSlugActive(slug);
    const activeHint = active
      ? " (ACTIVE — close this agent chat, quit Cursor, reopen kimi-toolchain.code-workspace)"
      : "";
    checks.push({
      name: "cursor-workspace",
      status: isBlocker ? "error" : "warn",
      message: `legacy slug ${slug}${activeHint} — run kimi-toolchain workspace fix --deep`,
      fixable: true,
    });
  }

  const indexPath = join(home, ".kimi-code", "sessions", "session_index.jsonl");
  if (isToolchain && existsSync(indexPath)) {
    let legacyIndexLines = 0;
    for (const line of readFileSync(indexPath, "utf8").split("\n").filter(Boolean)) {
      const entry = safeParse(line, null as { cwd?: string; workDir?: string } | null);
      const cwd = entry?.cwd || entry?.workDir || "";
      if (LEGACY_REPO_NAMES.some((l) => cwd.includes(l))) legacyIndexLines++;
    }
    if (legacyIndexLines > 0) {
      checks.push({
        name: "session-index",
        status: strict ? "error" : "warn",
        message: `${legacyIndexLines} session_index line(s) reference legacy cwd — workspace fix --deep`,
        fixable: true,
      });
    }
  }

  return {
    checks,
    staleWrappers,
    missingWrappers,
    orphanedSnapshots,
    legacySessionWorkspaces,
    legacyCursorSlugs,
    isToolchainRepo: isToolchain,
    canonicalClonePresent,
  };
}

export function isWorkspaceBlocker(
  check: WorkspaceCheck,
  options: { isToolchainRepo?: boolean; strictWorkspace?: boolean } = {}
): boolean {
  const isToolchain = options.isToolchainRepo ?? false;
  const strict = options.strictWorkspace ?? false;

  if (check.status === "warn") {
    return strict && WORKSPACE_SOFT_NAMES.has(check.name);
  }
  if (check.status !== "error") return false;

  if (!isToolchain) {
    return check.name === "package-json" || check.name === "physical-folder";
  }

  return (
    WORKSPACE_BLOCKER_NAMES.has(check.name) ||
    check.name === "kimi-binary" ||
    (strict && WORKSPACE_SOFT_NAMES.has(check.name))
  );
}

export function countWorkspaceBlockers(
  report: WorkspaceHealthReport,
  options: { strictWorkspace?: boolean } = {}
): { blocking: number; warnings: number; errors: number } {
  const strict = options.strictWorkspace ?? false;
  let blocking = 0;
  let warnings = 0;
  let errors = 0;

  for (const check of report.checks) {
    if (check.status === "warn") warnings++;
    if (check.status === "error") errors++;
    if (
      isWorkspaceBlocker(check, {
        isToolchainRepo: report.isToolchainRepo,
        strictWorkspace: strict,
      })
    ) {
      blocking++;
    }
  }

  return { blocking, warnings, errors };
}

export function removeStaleWrappers(staleWrappers: string[], binDir: string): number {
  let removed = 0;
  for (const name of staleWrappers) {
    const path = join(binDir, name);
    if (existsSync(path)) {
      unlinkSync(path);
      removed++;
    }
  }
  return removed;
}

export async function removeOrphanedSnapshots(snapshotDir: string): Promise<number> {
  if (!existsSync(snapshotDir)) return 0;
  let removed = 0;
  const glob = new Bun.Glob("*.json");
  for (const file of glob.scanSync({ cwd: snapshotDir, absolute: true })) {
    let remove = false;
    const snap = safeParse(
      readFileSync(file, "utf8"),
      null as {
        id?: string;
        project?: string;
        commit?: string;
        projectPath?: string;
      } | null
    );
    if (!snap?.id || !snap?.project || !snap?.commit) remove = true;
    else if (snap.projectPath && !existsSync(snap.projectPath)) remove = true;
    if (remove) {
      unlinkSync(file);
      removed++;
    }
  }
  return removed;
}

export async function fixWorkspaceHealth(
  report: WorkspaceHealthReport,
  options: FixWorkspaceOptions
): Promise<FixWorkspaceResult> {
  const home = options.home ?? Bun.env.HOME ?? "/tmp";
  const binDir = join(home, ".local", "bin");
  const snapshotDir = join(home, ".kimi-code", "snapshots");
  const result: FixWorkspaceResult = {
    staleWrappersRemoved: 0,
    snapshotsRemoved: 0,
    cursorSlugsRemoved: [],
    legacySymlinkRemoved: false,
    sessionsArchived: [],
    sessionIndexLinesPruned: 0,
    syncRan: false,
    wrappersInstalled: false,
  };

  if (report.staleWrappers.length > 0) {
    result.staleWrappersRemoved = removeStaleWrappers(report.staleWrappers, binDir);
  }

  if (report.orphanedSnapshots > 0) {
    result.snapshotsRemoved = await removeOrphanedSnapshots(snapshotDir);
  }

  const needsSync =
    options.syncDesktop ??
    report.checks.some((c) => c.name === "desktop-tools" && c.status === "error");
  if (needsSync) {
    const syncScript = join(options.projectRoot, "scripts", "sync-to-desktop.ts");
    if (existsSync(syncScript)) {
      const proc = Bun.spawn(["bun", "run", syncScript], {
        cwd: options.projectRoot,
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      result.syncRan = true;
    }
  }

  const needsWrappers = options.installWrappers ?? report.missingWrappers.length > 0;
  if (needsWrappers) {
    const wrapperScript = join(options.projectRoot, "scripts", "install-bin-wrappers.sh");
    if (existsSync(wrapperScript)) {
      const proc = Bun.spawn(["bash", wrapperScript], {
        cwd: options.projectRoot,
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      result.wrappersInstalled = true;
    }
  }

  if (options.removeLegacySymlink) {
    result.legacySymlinkRemoved = removeLegacySymlink();
  }

  if (options.removeCursorSlugs && report.legacyCursorSlugs.length > 0) {
    result.cursorSlugsRemoved = removeLegacyCursorSlugs();
  }

  if (options.archiveLegacySessions) {
    result.sessionsArchived = archiveLegacyKimiSessions();
  }

  if (options.pruneLegacySessionIndex) {
    result.sessionIndexLinesPruned = pruneLegacySessionIndex();
  }

  return result;
}

/** Backward-compatible alias used by path-alignment consumers. */
export async function auditPathAlignment(projectRoot: string): Promise<WorkspaceHealthReport> {
  return auditWorkspaceHealth(projectRoot);
}

export type PathAlignmentCheck = WorkspaceCheck;
export type PathAlignmentReport = WorkspaceHealthReport;
