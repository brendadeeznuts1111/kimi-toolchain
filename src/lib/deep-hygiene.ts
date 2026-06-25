/**
 * Deep hygiene — multi-root scans, node_modules tilde pollution, advisory inventory.
 */

import { join, relative } from "path"; // @bun-native-exempt:soft-banned-import
import { listDir, pathExists, pathStat } from "./bun-io.ts";
import { countTree, formatHygieneBytes } from "./hygiene-utils.ts";
import { homeDir } from "./paths.ts";
import type { PathHygieneItem } from "./path-hygiene.ts";
import { PATH_HYGIENE_SKIP_DIRS } from "./path-hygiene.ts";

export const PATH_HYGIENE_DEEP_MAX_DEPTH = 12;

/** Active codex worktrees — report others as advisory only. */
export const ACTIVE_CODEX_WORKTREE_IDS = new Set(["098c", "328a"]);

export interface DeepInventoryEntry {
  relPath: string;
  absolutePath: string;
  bytes: number;
  kind:
    | "codex-worktree"
    | "grok-worktree"
    | "herdr-worktrees"
    | "archive"
    | "experimental"
    | "ide-cache"
    | "stale-pack";
  advisory: string;
}

export function defaultDeepScanPaths(home = homeDir()): string[] {
  const candidates = [home, join(home, "Projects"), join(home, ".codex"), join(home, ".grok")];
  return candidates.filter((p) => pathExists(p));
}

function dirBytes(path: string): number {
  try {
    if (!pathStat(path).isDirectory()) return pathStat(path).size;
    return countTree(path).bytes;
  } catch {
    return 0;
  }
}

function walkNodeModulesForTilde(
  scanRoot: string,
  dir: string,
  depth: number,
  maxDepth: number,
  items: PathHygieneItem[]
): void {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const full = join(dir, name);
    if (name === "~") {
      const { bytes, files } = countTree(full);
      items.push({
        relPath: relative(scanRoot, full) || full,
        kind: "literal-tilde-dir",
        bytes,
        fileCount: files,
        cause:
          "Literal ~ inside node_modules (Bun cache misconfig) — safe to delete; run bun install to restore",
        absolutePath: full,
      });
      continue;
    }
    walkNodeModulesForTilde(scanRoot, full, depth + 1, maxDepth, items);
  }
}

/** Targeted scan: literal ~ dirs under repo node_modules (skipped by home-wide walks). */
export function collectNodeModulesTildeDirs(repoRoot: string, maxDepth = 24): PathHygieneItem[] {
  const nm = join(repoRoot, "node_modules");
  if (!pathExists(nm)) return [];
  const items: PathHygieneItem[] = [];
  walkNodeModulesForTilde(repoRoot, nm, 0, maxDepth, items);
  return items.sort((a, b) => b.bytes - a.bytes);
}

function inventoryEntry(
  home: string,
  absPath: string,
  kind: DeepInventoryEntry["kind"],
  advisory: string
): DeepInventoryEntry | null {
  if (!pathExists(absPath)) return null;
  const bytes = dirBytes(absPath);
  if (bytes === 0) return null;
  return {
    relPath: relative(home, absPath) || absPath,
    absolutePath: absPath,
    bytes,
    kind,
    advisory,
  };
}

/** Large or stale trees for manual review — never auto-deleted. */
export function collectDeepInventory(home = homeDir()): DeepInventoryEntry[] {
  const entries: DeepInventoryEntry[] = [];

  const codexWt = join(home, ".codex", "worktrees");
  if (pathExists(codexWt)) {
    for (const name of listDir(codexWt)) {
      const full = join(codexWt, name);
      try {
        if (!pathStat(full).isDirectory()) continue;
      } catch {
        continue;
      }
      const bytes = dirBytes(full);
      if (ACTIVE_CODEX_WORKTREE_IDS.has(name)) {
        if (bytes > 200_000_000) {
          entries.push({
            relPath: relative(home, full) || full,
            absolutePath: full,
            bytes,
            kind: "codex-worktree",
            advisory: `Active worktree ${name} is ${formatHygieneBytes(bytes)} — prune only if unused`,
          });
        }
        continue;
      }
      entries.push({
        relPath: relative(home, full) || full,
        absolutePath: full,
        bytes,
        kind: "codex-worktree",
        advisory: `Stale codex worktree (not in ${[...ACTIVE_CODEX_WORKTREE_IDS].join(", ")}) — review before rm`,
      });
    }
  }

  const grokWt = join(home, ".grok", "worktrees");
  if (pathExists(grokWt)) {
    for (const name of listDir(grokWt)) {
      const full = join(grokWt, name);
      try {
        if (!pathStat(full).isDirectory()) continue;
      } catch {
        continue;
      }
      entries.push({
        relPath: relative(home, full) || full,
        absolutePath: full,
        bytes: dirBytes(full),
        kind: "grok-worktree",
        advisory: "Grok worktree — review before rm",
      });
    }
  }

  for (const [sub, label, minBytes] of [
    [
      join(home, ".codex", "logs_2.sqlite"),
      "Codex logs DB — vacuum or archive if stale",
      200_000_000,
    ],
    [join(home, ".codex", "sqlite"), "Codex sqlite dir — review session DB size", 200_000_000],
    [join(home, ".codex", "sessions"), "Codex sessions — prune old sessions in app", 100_000_000],
    [join(home, ".grok", "sessions"), "Grok sessions — prune old sessions in app", 200_000_000],
    [
      join(home, ".grok", "downloads"),
      "Grok installer downloads — safe to delete after install",
      50_000_000,
    ],
  ] as const) {
    if (!pathExists(sub)) continue;
    const bytes = dirBytes(sub);
    if (bytes < minBytes) continue;
    entries.push({
      relPath: relative(home, sub) || sub,
      absolutePath: sub,
      bytes,
      kind: "ide-cache",
      advisory: label,
    });
  }

  const activeDev = join(home, "Projects", "projects", "active", "development");
  if (pathExists(activeDev)) {
    for (const name of listDir(activeDev)) {
      if (!name.endsWith(".tgz")) continue;
      const full = join(activeDev, name);
      try {
        if (!pathStat(full).isFile()) continue;
      } catch {
        continue;
      }
      const bytes = pathStat(full).size;
      if (bytes < 10_000_000) continue;
      entries.push({
        relPath: relative(home, full) || full,
        absolutePath: full,
        bytes,
        kind: "stale-pack",
        advisory: "Stale pack tarball in development/ — safe to delete if published elsewhere",
      });
    }
  }

  for (const [sub, kind] of [
    [join(home, "Projects", "herdr-worktrees"), "herdr-worktrees"],
    [join(home, "Projects", "projects", "archive"), "archive"],
    [join(home, "Projects", "projects", "experimental"), "experimental"],
  ] as const) {
    const hit = inventoryEntry(
      home,
      sub,
      kind,
      kind === "herdr-worktrees"
        ? "Herdr worktrees — remove when no active stacks"
        : kind === "archive"
          ? "Archived projects — keep unless reclaiming space"
          : "Experimental projects — manual review only (do not auto-delete)"
    );
    if (hit && hit.bytes > 50_000_000) entries.push(hit);
  }

  return entries.sort((a, b) => b.bytes - a.bytes);
}

/** Deep scan skips fewer trees than default home scan. */
export function deepPathSkipDirs(): ReadonlySet<string> {
  const skip = new Set(PATH_HYGIENE_SKIP_DIRS);
  // Allow descending into .codex / .grok; still skip heavy media/system dirs.
  return skip;
}
