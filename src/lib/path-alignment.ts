/**
 * Path + naming alignment between repo, ~/.kimi-code/, and PATH wrappers.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, unlinkSync } from "fs";
import { basename, join, resolve } from "path";

export const CANONICAL_REPO_NAME = "kimi-toolchain";
export const LEGACY_REPO_NAMES = ["kimicode-cli", "kimi-code-cli"] as const;

export interface PathAlignmentCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface PathAlignmentReport {
  checks: PathAlignmentCheck[];
  staleWrappers: string[];
  missingWrappers: string[];
  orphanedSnapshots: number;
  legacySessionWorkspaces: string[];
}

export async function getExpectedBinNames(repoRoot: string): Promise<string[]> {
  try {
    const pkg = (await Bun.file(join(repoRoot, "package.json")).json()) as {
      bin?: Record<string, string>;
    };
    return Object.keys(pkg.bin || {}).sort();
  } catch {
    return [];
  }
}

export function listInstalledWrappers(binDir: string): string[] {
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .filter((f) => f.startsWith("kimi-"))
    .sort();
}

export async function listStaleWrappers(repoRoot: string, binDir: string): Promise<string[]> {
  const expected = new Set(await getExpectedBinNames(repoRoot));
  return listInstalledWrappers(binDir).filter((name) => !expected.has(name));
}

export async function listMissingWrappers(repoRoot: string, binDir: string): Promise<string[]> {
  const expected = await getExpectedBinNames(repoRoot);
  return expected.filter((name) => !existsSync(join(binDir, name)));
}

function legacyClonePath(home: string): string {
  return join(home, LEGACY_REPO_NAMES[0]);
}

function canonicalClonePath(home: string): string {
  return join(home, CANONICAL_REPO_NAME);
}

function countOrphanedSnapshots(snapshotDir: string): number {
  if (!existsSync(snapshotDir)) return 0;
  let orphaned = 0;
  const glob = new Bun.Glob("*.json");
  for (const file of glob.scanSync({ cwd: snapshotDir, absolute: true })) {
    try {
      const snap = JSON.parse(readFileSync(file, "utf8")) as { projectPath?: string };
      if (snap.projectPath && !existsSync(snap.projectPath)) orphaned++;
    } catch {
      orphaned++;
    }
  }
  return orphaned;
}

function listLegacySessionWorkspaces(sessionsDir: string): string[] {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir).filter((name) =>
    LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))
  );
}

function countMismatchedSessionCwds(sessionIndexPath: string, expectedCwd: string): number {
  if (!existsSync(sessionIndexPath)) return 0;
  const expected = resolve(expectedCwd);
  let mismatched = 0;
  try {
    const lines = readFileSync(sessionIndexPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { cwd?: string; workDir?: string };
        const cwd = entry.cwd || entry.workDir;
        if (cwd && resolve(cwd) !== expected) mismatched++;
      } catch {
        /* skip malformed lines */
      }
    }
  } catch {
    return 0;
  }
  return mismatched;
}

function cursorProjectSlugDrift(home: string): string | null {
  const cursorProjects = join(home, ".cursor", "projects");
  if (!existsSync(cursorProjects)) return null;
  for (const name of readdirSync(cursorProjects)) {
    if (LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))) {
      return name;
    }
  }
  return null;
}

export async function auditPathAlignment(projectRoot: string): Promise<PathAlignmentReport> {
  const home = Bun.env.HOME || "/tmp";
  const binDir = join(home, ".local", "bin");
  const snapshotDir = join(home, ".kimi-code", "snapshots");
  const sessionsDir = join(home, ".kimi-code", "sessions");
  const checks: PathAlignmentCheck[] = [];

  const resolvedRoot = resolve(projectRoot);
  const repoName = basename(resolvedRoot);
  let physicalName = repoName;
  try {
    physicalName = basename(realpathSync(resolvedRoot));
  } catch {
    /* keep repoName */
  }
  let pkgName = "unknown";
  try {
    const pkg = (await Bun.file(join(projectRoot, "package.json")).json()) as { name?: string };
    pkgName = pkg.name || "unknown";
  } catch {
    pkgName = "missing";
  }

  if (pkgName === CANONICAL_REPO_NAME) {
    if (repoName === CANONICAL_REPO_NAME) {
      checks.push({
        name: "repo-folder",
        status: "ok",
        message: `${CANONICAL_REPO_NAME}/ matches package name`,
        fixable: false,
      });
    } else if (physicalName === CANONICAL_REPO_NAME) {
      checks.push({
        name: "repo-folder",
        status: "warn",
        message: `opened via ${repoName}/ — use ~/${CANONICAL_REPO_NAME} in Cursor (symlink/legacy path)`,
        fixable: false,
      });
    } else {
      checks.push({
        name: "repo-folder",
        status: "warn",
        message: `folder is ${repoName}/ — rename to ${CANONICAL_REPO_NAME}/ for alignment`,
        fixable: false,
      });
    }
  }

  const legacyPath = legacyClonePath(home);
  const canonicalPath = canonicalClonePath(home);
  if (existsSync(legacyPath)) {
    checks.push({
      name: "legacy-clone",
      status: "warn",
      message:
        resolvedRoot === legacyPath
          ? `repo still at ${LEGACY_REPO_NAMES[0]}/ — rename clone to ${CANONICAL_REPO_NAME}/`
          : `${legacyPath} still exists — use ${canonicalPath} only`,
      fixable: false,
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
  } else if (pkgName === CANONICAL_REPO_NAME) {
    checks.push({
      name: "canonical-clone",
      status: "warn",
      message: `toolchain repo not at ${canonicalPath}`,
      fixable: false,
    });
  }

  const staleWrappers = await listStaleWrappers(projectRoot, binDir);
  const missingWrappers = await listMissingWrappers(projectRoot, binDir);

  if (staleWrappers.length === 0) {
    checks.push({
      name: "path-wrappers",
      status: "ok",
      message: "no stale ~/.local/bin/kimi-* wrappers",
      fixable: false,
    });
  } else {
    checks.push({
      name: "path-wrappers",
      status: "warn",
      message: `${staleWrappers.length} stale: ${staleWrappers.join(", ")}`,
      fixable: true,
    });
  }

  if (missingWrappers.length === 0) {
    checks.push({
      name: "wrapper-coverage",
      status: "ok",
      message: "all package.json bin entries have wrappers",
      fixable: false,
    });
  } else {
    checks.push({
      name: "wrapper-coverage",
      status: "error",
      message: `${missingWrappers.length} missing: ${missingWrappers.join(", ")}`,
      fixable: true,
    });
  }

  const toolsDir = join(home, ".kimi-code", "tools");
  const expectedBins = await getExpectedBinNames(projectRoot);
  if (pkgName === CANONICAL_REPO_NAME && existsSync(toolsDir)) {
    const installedTools = readdirSync(toolsDir).filter((f) => f.endsWith(".ts")).length;
    if (installedTools >= expectedBins.length) {
      checks.push({
        name: "desktop-tools",
        status: "ok",
        message: `${installedTools} tools in ~/.kimi-code/tools/`,
        fixable: false,
      });
    } else {
      checks.push({
        name: "desktop-tools",
        status: "error",
        message: `${installedTools}/${expectedBins.length} tools — run bun run sync`,
        fixable: true,
      });
    }
  }

  const orphanedSnapshots = countOrphanedSnapshots(snapshotDir);
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
          status: "warn",
          message: `${orphanedSnapshots} snapshot(s) point to missing project paths`,
          fixable: true,
        }
  );

  const legacySessionWorkspaces = listLegacySessionWorkspaces(sessionsDir);
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
          status: "warn",
          message: `${legacySessionWorkspaces.length} legacy wd_* folder(s) — open ${CANONICAL_REPO_NAME}/ for new sessions`,
          fixable: false,
        }
  );

  const sessionIndex = join(sessionsDir, "session_index.jsonl");
  if (pkgName === CANONICAL_REPO_NAME && existsSync(sessionIndex)) {
    const mismatched = countMismatchedSessionCwds(sessionIndex, canonicalPath);
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
            status: "warn",
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
  } else {
    checks.push({
      name: "kimi-binary",
      status: "error",
      message: "kimi not on PATH",
      fixable: false,
    });
  }

  const cursorSlug = cursorProjectSlugDrift(home);
  if (cursorSlug) {
    checks.push({
      name: "cursor-workspace",
      status: "warn",
      message: `legacy slug ${cursorSlug} — reopen ${canonicalPath} in Cursor`,
      fixable: false,
    });
  }

  return {
    checks,
    staleWrappers,
    missingWrappers,
    orphanedSnapshots,
    legacySessionWorkspaces,
  };
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
    try {
      const snap = JSON.parse(readFileSync(file, "utf8")) as {
        id?: string;
        project?: string;
        commit?: string;
        projectPath?: string;
      };
      if (!snap.id || !snap.project || !snap.commit) remove = true;
      else if (snap.projectPath && !existsSync(snap.projectPath)) remove = true;
    } catch {
      remove = true;
    }
    if (remove) {
      unlinkSync(file);
      removed++;
    }
  }
  return removed;
}
