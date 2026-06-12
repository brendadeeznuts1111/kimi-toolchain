#!/usr/bin/env bun
/**
 * kimi-cleanup-legacy — One-shot legacy path migration tool
 *
 * Handles kimicode-cli → kimi-toolchain rename cleanup:
 *   - Archive legacy wd_kimicode-cli_* session folders
 *   - Prune legacy cwd entries from session_index.jsonl
 *   - Remove legacy Cursor workspace slugs
 *   - Remove legacy symlink at ~/kimicode-cli
 *   - Report what was found vs cleaned
 *
 * Usage:
 *   kimi-cleanup-legacy [doctor|fix|status]
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
import {
  printToolBanner,
  printSection,
  log,
  buildDoctorReport,
  printDoctorReport,
} from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const CANONICAL_REPO_NAME = "kimi-toolchain";
const LEGACY_REPO_NAMES = ["kimicode-cli", "kimi-code-cli"] as const;
const SLUG_ACTIVE_MS = 3_600_000; // 1 hour

// ── Types ────────────────────────────────────────────────────────────

interface LegacyStatus {
  legacySessions: string[];
  legacyIndexLines: number;
  legacyCursorSlugs: string[];
  activeCursorSlugs: string[];
  legacySymlinkExists: boolean;
  legacyCloneExists: boolean;
}

interface CleanupResult {
  sessionsArchived: string[];
  indexLinesPruned: number;
  cursorSlugsRemoved: string[];
  legacySymlinkRemoved: boolean;
}

// ── Discovery ────────────────────────────────────────────────────────

function sessionPathHasLegacyName(name: string): boolean {
  return name.startsWith("wd_") && LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy));
}

function listLegacySessionWorkspaces(sessionsDir: string): string[] {
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

function listLegacyCursorSlugs(home: string): string[] {
  const cursorProjects = join(home, ".cursor", "projects");
  if (!existsSync(cursorProjects)) return [];
  return readdirSync(cursorProjects).filter((name) =>
    LEGACY_REPO_NAMES.some((legacy) => name.includes(legacy))
  );
}

function isCursorSlugActive(home: string, slug: string, maxAgeMs = SLUG_ACTIVE_MS): boolean {
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

export function runLegacyCleanup(home: string): CleanupResult {
  return {
    sessionsArchived: archiveLegacyKimiSessions(home),
    indexLinesPruned: pruneLegacySessionIndex(home),
    cursorSlugsRemoved: removeLegacyCursorSlugs(home),
    legacySymlinkRemoved: removeLegacySymlink(home),
  };
}

// ── Doctor ───────────────────────────────────────────────────────────

function doctor(home: string) {
  const status = getLegacyStatus(home);
  const checks: {
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }[] = [];

  checks.push(
    status.legacySessions.length === 0
      ? {
          name: "legacy-sessions",
          status: "ok",
          message: "no legacy wd_* session folders",
          fixable: false,
        }
      : {
          name: "legacy-sessions",
          status: "warn",
          message: `${status.legacySessions.length} legacy session folder(s): ${status.legacySessions.join(", ")}`,
          fixable: true,
        }
  );

  checks.push(
    status.legacyIndexLines === 0
      ? {
          name: "legacy-index",
          status: "ok",
          message: "no legacy cwd entries in session_index",
          fixable: false,
        }
      : {
          name: "legacy-index",
          status: "warn",
          message: `${status.legacyIndexLines} legacy session_index line(s)`,
          fixable: true,
        }
  );

  checks.push(
    status.legacyCursorSlugs.length === 0
      ? {
          name: "legacy-cursor",
          status: "ok",
          message: "no legacy Cursor workspace slugs",
          fixable: false,
        }
      : {
          name: "legacy-cursor",
          status: status.activeCursorSlugs.length > 0 ? "error" : "warn",
          message: `${status.legacyCursorSlugs.length} legacy slug(s)${status.activeCursorSlugs.length > 0 ? ` (${status.activeCursorSlugs.length} active)` : ""}`,
          fixable: true,
        }
  );

  checks.push(
    !status.legacySymlinkExists
      ? {
          name: "legacy-symlink",
          status: "ok",
          message: `no ${LEGACY_REPO_NAMES[0]} symlink`,
          fixable: false,
        }
      : {
          name: "legacy-symlink",
          status: "warn",
          message: `${LEGACY_REPO_NAMES[0]} symlink exists`,
          fixable: true,
        }
  );

  checks.push(
    !status.legacyCloneExists
      ? {
          name: "legacy-clone",
          status: "ok",
          message: `no ${LEGACY_REPO_NAMES[0]} directory`,
          fixable: false,
        }
      : {
          name: "legacy-clone",
          status: "warn",
          message: `${LEGACY_REPO_NAMES[0]} directory still exists — rename to ${CANONICAL_REPO_NAME}/`,
          fixable: false,
        }
  );

  const report = buildDoctorReport("kimi-cleanup-legacy", checks);
  printDoctorReport(report);
  const exitCode = report.checks.some((c) => c.status === "error") ? 1 : 0;
  process.exit(exitCode);
}

// ── Main ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const home = Bun.env.HOME || "/tmp";
  const cmd = Bun.argv[2] || "status";

  if (cmd === "doctor") {
    doctor(home);
  } else if (cmd === "fix") {
    printToolBanner("kimi-cleanup-legacy", "Legacy path migration cleanup");
    const status = getLegacyStatus(home);

    printSection("Discovery");
    log("info", `${status.legacySessions.length} legacy session folders`);
    log("info", `${status.legacyIndexLines} legacy index lines`);
    log(
      "info",
      `${status.legacyCursorSlugs.length} legacy Cursor slugs (${status.activeCursorSlugs.length} active)`
    );
    log("info", `${status.legacySymlinkExists ? 1 : 0} legacy symlinks`);

    printSection("Cleanup");
    const result = runLegacyCleanup(home);

    if (result.sessionsArchived.length > 0)
      log("info", `Archived ${result.sessionsArchived.length} session folders`);
    if (result.indexLinesPruned > 0) log("info", `Pruned ${result.indexLinesPruned} index lines`);
    if (result.cursorSlugsRemoved.length > 0)
      log("info", `Removed ${result.cursorSlugsRemoved.length} Cursor slugs`);
    if (result.legacySymlinkRemoved) log("info", `Removed legacy symlink`);

    const total =
      result.sessionsArchived.length +
      result.indexLinesPruned +
      result.cursorSlugsRemoved.length +
      (result.legacySymlinkRemoved ? 1 : 0);
    if (total === 0) log("info", "Nothing to clean — already tidy");

    printSection("Remaining");
    const after = getLegacyStatus(home);
    if (after.legacyCloneExists)
      log(
        "warn",
        `${LEGACY_REPO_NAMES[0]}/ directory still exists — rename manually to ${CANONICAL_REPO_NAME}/`
      );
    if (after.activeCursorSlugs.length > 0)
      log(
        "warn",
        `${after.activeCursorSlugs.length} active Cursor slug(s) — close agent chat, quit Cursor, reopen workspace`
      );
    if (
      !after.legacyCloneExists &&
      after.legacyCursorSlugs.length === 0 &&
      after.legacySessions.length === 0 &&
      after.legacyIndexLines === 0
    ) {
      log("info", "All legacy artifacts resolved ✓");
    }
  } else {
    // status
    printToolBanner("kimi-cleanup-legacy", "Legacy path migration status");
    const status = getLegacyStatus(home);
    printSection("Legacy Artifacts");
    log(
      status.legacySessions.length === 0 ? "info" : "warn",
      `Session folders: ${status.legacySessions.length}`
    );
    log(status.legacyIndexLines === 0 ? "info" : "warn", `Index lines: ${status.legacyIndexLines}`);
    log(
      status.legacyCursorSlugs.length === 0 ? "info" : "warn",
      `Cursor slugs: ${status.legacyCursorSlugs.length} (${status.activeCursorSlugs.length} active)`
    );
    log(
      !status.legacySymlinkExists ? "info" : "warn",
      `Symlink: ${status.legacySymlinkExists ? "yes" : "no"}`
    );
    log(
      !status.legacyCloneExists ? "info" : "warn",
      `Clone dir: ${status.legacyCloneExists ? "yes" : "no"}`
    );
  }
}
