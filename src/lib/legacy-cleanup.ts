/**
 * Legacy cleanup utilities — shared between kimi-cleanup-legacy and workspace-health.
 * Kept in lib/ so both src/bin/ and src/lib/ can import without cross-directory issues.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const CANONICAL_REPO_NAME = "kimi-toolchain";
const LEGACY_REPO_NAMES = ["kimicode-cli", "kimi-code-cli"] as const;
const SLUG_ACTIVE_MS = 3_600_000; // 1 hour

// ── Discovery ────────────────────────────────────────────────────────

function sessionPathHasLegacyName(name: string): boolean {
  return name.startsWith("wd_") && LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy));
}

export function listLegacySessionWorkspaces(sessionsDir: string): string[] {
  if (!existsSync(sessionsDir)) return [];
  const hits: string[] = [];
  for (const entry of readdirSync(sessionsDir)) {
    if (entry.startsWith("wd_") && LEGACY_REPO_NAMES.some((legacy) => entry.includes(legacy))) {
      hits.push(entry);
    }
  }
  return hits;
}

function countLegacyIndexLines(home: string): number {
  const indexPath = join(home, ".kimi-code", "sessions", "session_index.jsonl");
  if (!existsSync(indexPath)) return 0;
  let count = 0;
  for (const line of readFileSync(indexPath, "utf8").split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as { cwd?: string; workDir?: string };
      const cwd = entry.cwd || entry.workDir || "";
      if (LEGACY_REPO_NAMES.some((l) => cwd.includes(l))) count++;
    } catch {
      /* skip */
    }
  }
  return count;
}

export function listLegacyCursorSlugs(home: string): string[] {
  const cursorProjects = join(home, ".cursor", "projects");
  if (!existsSync(cursorProjects)) return [];
  return readdirSync(cursorProjects).filter((name) =>
    LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))
  );
}

export function isCursorSlugActive(home: string, slug: string, maxAgeMs = SLUG_ACTIVE_MS): boolean {
  const slugPath = join(home, ".cursor", "projects", slug);
  if (!existsSync(slugPath)) return false;
  const cutoff = Date.now() - maxAgeMs;
  try {
    if (lstatSync(slugPath).mtimeMs >= cutoff) return true;
  } catch {
    /* continue */
  }
  const transcripts = join(slugPath, "agent-transcripts");
  if (!existsSync(transcripts)) return false;
  for (const name of readdirSync(transcripts)) {
    try {
      const path = join(transcripts, name);
      if (lstatSync(path).mtimeMs >= cutoff) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

function legacyClonePath(home: string): string {
  return join(home, LEGACY_REPO_NAMES[0]);
}

interface LegacyStatus {
  legacySessions: string[];
  legacyIndexLines: number;
  legacyCursorSlugs: string[];
  activeCursorSlugs: string[];
  legacySymlinkExists: boolean;
  legacyCloneExists: boolean;
}

export function getLegacyStatus(home: string): LegacyStatus {
  const sessionsDir = join(home, ".kimi-code", "sessions");
  const legacySessions = listLegacySessionWorkspaces(sessionsDir);
  const legacyIndexLines = countLegacyIndexLines(home);
  const legacyCursorSlugs = listLegacyCursorSlugs(home);
  const activeCursorSlugs = legacyCursorSlugs.filter((slug) => isCursorSlugActive(home, slug));
  const legacySymlinkExists = existsSync(legacyClonePath(home));
  const legacyCloneExists =
    existsSync(legacyClonePath(home)) && lstatSync(legacyClonePath(home)).isDirectory();

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

export function archiveLegacyKimiSessions(home: string): string[] {
  const sessionsDir = join(home, ".kimi-code", "sessions");
  if (!existsSync(sessionsDir)) return [];
  const archiveRoot = join(sessionsDir, "archive");
  const archived: string[] = [];
  const stamp = new Date().toISOString().slice(0, 10);

  for (const name of readdirSync(sessionsDir)) {
    if (!sessionPathHasLegacyName(name)) continue;
    const src = join(sessionsDir, name);
    try {
      if (!lstatSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    mkdirSync(archiveRoot, { recursive: true });
    const dest = join(archiveRoot, `${name}-${stamp}`);
    renameSync(src, dest);
    archived.push(name);
  }
  return archived;
}

export function pruneLegacySessionIndex(home: string): number {
  const indexPath = join(home, ".kimi-code", "sessions", "session_index.jsonl");
  if (!existsSync(indexPath)) return 0;
  const lines = readFileSync(indexPath, "utf8").split("\n");
  const kept: string[] = [];
  let pruned = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { cwd?: string; workDir?: string };
      const cwd = entry.cwd || entry.workDir || "";
      if (LEGACY_REPO_NAMES.some((legacy) => cwd.includes(legacy))) {
        pruned++;
        continue;
      }
      kept.push(line);
    } catch {
      kept.push(line);
    }
  }

  writeFileSync(indexPath, kept.length > 0 ? `${kept.join("\n")}\n` : "");
  return pruned;
}

export function removeLegacyCursorSlugs(home: string): string[] {
  const removed: string[] = [];
  const cursorProjects = join(home, ".cursor", "projects");
  for (const slug of listLegacyCursorSlugs(home)) {
    const path = join(cursorProjects, slug);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      removed.push(slug);
    }
  }
  return removed;
}

export function removeLegacySymlink(home: string): boolean {
  const legacyPath = legacyClonePath(home);
  if (existsSync(legacyPath)) {
    try {
      if (lstatSync(legacyPath).isSymbolicLink()) {
        unlinkSync(legacyPath);
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

export function runLegacyCleanup(home: string): CleanupResult {
  return {
    sessionsArchived: archiveLegacyKimiSessions(home),
    indexLinesPruned: pruneLegacySessionIndex(home),
    cursorSlugsRemoved: removeLegacyCursorSlugs(home),
    legacySymlinkRemoved: removeLegacySymlink(home),
  };
}

export { CANONICAL_REPO_NAME, LEGACY_REPO_NAMES };
