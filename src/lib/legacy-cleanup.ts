/**
 * Legacy cleanup utilities — shared between kimi-cleanup-legacy and workspace-health.
 * Kept in lib/ so both src/bin/ and src/lib/ can import without cross-directory issues.
 */

import {
  listDir,
  makeDir,
  movePath,
  pathExists,
  pathLstat,
  readText,
  removeFile,
  removePath,
  writeText,
} from "./bun-io.ts";

import { join } from "path";
import { safeParse } from "./utils.ts";
import { homeDir, desktopRoot } from "./paths.ts";

const CANONICAL_REPO_NAME = "kimi-toolchain";
const LEGACY_REPO_NAMES = ["kimicode-cli", "kimi-code-cli"] as const;
const SLUG_ACTIVE_MS = 3_600_000; // 1 hour
const SESSION_PREFIX = "wd_";
const SESSION_INDEX_FILE = "session_index.jsonl";
const CURSOR_PROJECTS_DIR = "projects";
const AGENT_TRANSCRIPTS_DIR = "agent-transcripts";
const ARCHIVE_SUBDIR = "archive";
const DATE_STAMP_LENGTH = 10; // YYYY-MM-DD

interface IndexEntry {
  cwd?: string;
  workDir?: string;
}

function parseIndexEntry(line: string): IndexEntry | undefined {
  const entry = safeParse(line, null);
  if (typeof entry !== "object" || entry === null) return undefined;
  const obj = entry as Record<string, unknown>;
  const cwd = obj.cwd;
  const workDir = obj.workDir;
  return {
    cwd: typeof cwd === "string" ? cwd : undefined,
    workDir: typeof workDir === "string" ? workDir : undefined,
  };
}

function getIndexCwd(entry: IndexEntry): string {
  return entry.cwd || entry.workDir || "";
}

function isLegacyCwd(cwd: string): boolean {
  return LEGACY_REPO_NAMES.some((legacy) => cwd.includes(legacy));
}

function sessionPathHasLegacyName(name: string): boolean {
  return (
    name.startsWith(SESSION_PREFIX) && LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))
  );
}

export function listLegacySessionWorkspaces(sessionsDir: string): string[] {
  if (!pathExists(sessionsDir)) return [];
  const hits: string[] = [];
  for (const entry of listDir(sessionsDir)) {
    if (sessionPathHasLegacyName(entry)) {
      hits.push(entry);
    }
  }
  return hits;
}

function countLegacyIndexLines(): number {
  const indexPath = join(desktopRoot(), "sessions", SESSION_INDEX_FILE);
  if (!pathExists(indexPath)) return 0;
  let count = 0;
  for (const line of readText(indexPath).split("\n").filter(Boolean)) {
    const entry = parseIndexEntry(line);
    if (entry && isLegacyCwd(getIndexCwd(entry))) count++;
  }
  return count;
}

export function listLegacyCursorSlugs(home?: string): string[] {
  const cursorProjects = join(home || homeDir(), ".cursor", CURSOR_PROJECTS_DIR);
  if (!pathExists(cursorProjects)) return [];
  return listDir(cursorProjects).filter((name) =>
    LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))
  );
}

export function isCursorSlugActive(
  slug: string,
  maxAgeMs = SLUG_ACTIVE_MS,
  home?: string
): boolean {
  const slugPath = join(home || homeDir(), ".cursor", CURSOR_PROJECTS_DIR, slug);
  if (!pathExists(slugPath)) return false;
  const cutoff = Date.now() - maxAgeMs;
  try {
    if (pathLstat(slugPath).mtimeMs >= cutoff) return true;
  } catch {
    /* continue */
  }
  const transcripts = join(slugPath, AGENT_TRANSCRIPTS_DIR);
  if (!pathExists(transcripts)) return false;
  for (const name of listDir(transcripts)) {
    try {
      const path = join(transcripts, name);
      if (pathLstat(path).mtimeMs >= cutoff) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

function legacyClonePath(): string {
  return join(homeDir(), LEGACY_REPO_NAMES[0]);
}

interface LegacyStatus {
  legacySessions: string[];
  legacyIndexLines: number;
  legacyCursorSlugs: string[];
  activeCursorSlugs: string[];
  legacySymlinkExists: boolean;
  legacyCloneExists: boolean;
}

export function getLegacyStatus(): LegacyStatus {
  const sessionsDir = join(desktopRoot(), "sessions");
  const legacySessions = listLegacySessionWorkspaces(sessionsDir);
  const legacyIndexLines = countLegacyIndexLines();
  const legacyCursorSlugs = listLegacyCursorSlugs();
  const activeCursorSlugs = legacyCursorSlugs.filter((slug) => isCursorSlugActive(slug));
  const legacySymlinkExists = pathExists(legacyClonePath());
  const legacyCloneExists =
    pathExists(legacyClonePath()) && pathLstat(legacyClonePath()).isDirectory();

  return {
    legacySessions,
    legacyIndexLines,
    legacyCursorSlugs,
    activeCursorSlugs,
    legacySymlinkExists,
    legacyCloneExists,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function archiveLegacyKimiSessions(home?: string): string[] {
  const sessionsDir = join(home ? join(home, ".kimi-code") : desktopRoot(), "sessions");
  if (!pathExists(sessionsDir)) return [];
  const archiveRoot = join(sessionsDir, ARCHIVE_SUBDIR);
  const archived: string[] = [];
  const stamp = new Date().toISOString().slice(0, DATE_STAMP_LENGTH);

  for (const name of listDir(sessionsDir)) {
    if (!sessionPathHasLegacyName(name)) continue;
    const src = join(sessionsDir, name);
    try {
      if (!pathLstat(src).isDirectory()) continue;
    } catch {
      continue;
    }
    makeDir(archiveRoot, { recursive: true });
    const dest = join(archiveRoot, `${name}-${stamp}`);
    movePath(src, dest);
    archived.push(name);
  }
  return archived;
}

export function pruneLegacySessionIndex(home?: string): number {
  const indexPath = join(
    home ? join(home, ".kimi-code") : desktopRoot(),
    "sessions",
    SESSION_INDEX_FILE
  );
  if (!pathExists(indexPath)) return 0;
  const lines = readText(indexPath).split("\n");
  const kept: string[] = [];
  let pruned = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseIndexEntry(line);
    if (entry && isLegacyCwd(getIndexCwd(entry))) {
      pruned++;
      continue;
    }
    kept.push(line);
  }

  writeText(indexPath, kept.length > 0 ? `${kept.join("\n")}\n` : "");
  return pruned;
}

export function removeLegacyCursorSlugs(home?: string): string[] {
  const removed: string[] = [];
  const cursorProjects = join(home || homeDir(), ".cursor", CURSOR_PROJECTS_DIR);
  for (const slug of listLegacyCursorSlugs(home)) {
    const path = join(cursorProjects, slug);
    if (pathExists(path)) {
      removePath(path, { recursive: true, force: true });
      removed.push(slug);
    }
  }
  return removed;
}

export function removeLegacySymlink(): boolean {
  const legacyPath = legacyClonePath();
  if (pathExists(legacyPath)) {
    try {
      if (pathLstat(legacyPath).isSymbolicLink()) {
        removeFile(legacyPath);
        return true;
      }
    } catch {
      /* not a symlink */
    }
  }
  return false;
}

interface CleanupResult {
  sessionsArchived: string[];
  indexLinesPruned: number;
  cursorSlugsRemoved: string[];
  legacySymlinkRemoved: boolean;
}

export function runLegacyCleanup(): CleanupResult {
  return {
    sessionsArchived: archiveLegacyKimiSessions(),
    indexLinesPruned: pruneLegacySessionIndex(),
    cursorSlugsRemoved: removeLegacyCursorSlugs(),
    legacySymlinkRemoved: removeLegacySymlink(),
  };
}

export { CANONICAL_REPO_NAME, LEGACY_REPO_NAMES };
