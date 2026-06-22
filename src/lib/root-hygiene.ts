/**
 * Repo-root artifact hygiene — stray Bun cache dirs, profiles, and CPU captures.
 *
 * Bun 1.4.0 treats `~` literally in `[install.cache].dir` and `BUN_INSTALL_CACHE_DIR`
 * @see https://bun.com/docs/pm/global-cache
 */

import { join } from "path";
import { listDir, pathExists, pathStat, readText, removePath } from "./bun-io.ts";
import { homeDir } from "./paths.ts";

/** Default CPU/heap profile output under the project (gitignored via .kimi-artifacts/). */
export const DEFAULT_PROFILE_OUTPUT_DIR = ".kimi-artifacts/profiles";

export type RootHygieneKind =
  | "literal-tilde-dir"
  | "cpuprofile"
  | "profiles-dir"
  | "tmpdir"
  | "backup"
  | "empty-dir";

export interface RootHygieneItem {
  relPath: string;
  kind: RootHygieneKind;
  bytes: number;
  fileCount: number;
  cause: string;
}

export interface RootHygieneReport {
  projectRoot: string;
  dryRun: boolean;
  items: RootHygieneItem[];
  totalBytes: number;
  totalFiles: number;
  misconfig: string[];
}

/** Expand `~` / `~/…` for install-cache paths; pass through absolute/relative paths. */
export function expandInstallCacheDir(value: string | undefined, home = homeDir()): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2));
  return trimmed;
}

/** True when Bun will treat the value as a cwd-relative literal `~` segment. */
export function isLiteralTildeCachePath(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  return trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\");
}

export function envLiteralTildeCacheMisconfig(): string | null {
  const env = Bun.env.BUN_INSTALL_CACHE_DIR;
  if (!isLiteralTildeCachePath(env)) return null;
  const expanded = expandInstallCacheDir(env);
  return `BUN_INSTALL_CACHE_DIR=${env} — unset or use absolute path (${expanded})`;
}

export function bunfigLiteralTildeCacheDir(bunfigText: string): boolean {
  return /\[install\.cache\][\s\S]*?dir\s*=\s*"~/.test(bunfigText);
}

export function bunfigLiteralTildeCacheMisconfig(bunfigText: string): string | null {
  if (!bunfigLiteralTildeCacheDir(bunfigText)) return null;
  return '[install.cache].dir uses "~/" — omit dir from bunfig.toml; Bun default is ~/.bun/install/cache';
}

function countTree(path: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  try {
    const stat = pathStat(path);
    if (!stat.isDirectory()) {
      return { bytes: stat.size, files: 1 };
    }
    for (const entry of listDir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        const nested = countTree(full);
        bytes += nested.bytes;
        files += nested.files;
      } else if (entry.isFile()) {
        bytes += pathStat(full).size;
        files++;
      }
    }
  } catch {
    /* skip unreadable */
  }
  return { bytes, files };
}

function item(
  relPath: string,
  kind: RootHygieneKind,
  projectRoot: string,
  cause: string
): RootHygieneItem {
  const full = join(projectRoot, relPath);
  const { bytes, files } = countTree(full);
  return { relPath, kind, bytes, fileCount: files, cause };
}

/** Collect gitignored / accidental artifacts at repo root. */
export function collectRootHygieneItems(projectRoot: string): RootHygieneItem[] {
  const items: RootHygieneItem[] = [];
  if (!pathExists(projectRoot)) return items;

  for (const name of listDir(projectRoot)) {
    const full = join(projectRoot, name);
    let stat;
    try {
      stat = pathStat(full);
    } catch {
      continue;
    }

    if (name === "~") {
      items.push(
        item(
          name,
          "literal-tilde-dir",
          projectRoot,
          "Bun 1.4.0 does not expand ~ in [install.cache].dir or BUN_INSTALL_CACHE_DIR"
        )
      );
      continue;
    }

    if (name.startsWith(".tmp-") && stat.isDirectory()) {
      items.push(item(name, "tmpdir", projectRoot, "test temp dir"));
      continue;
    }

    if (name === "profiles" && stat.isDirectory()) {
      items.push(
        item(
          name,
          "profiles-dir",
          projectRoot,
          `bun run profile used ./profiles — prefer ${DEFAULT_PROFILE_OUTPUT_DIR}`
        )
      );
      continue;
    }

    if (name.endsWith(".cpuprofile") && stat.isFile()) {
      items.push(
        item(name, "cpuprofile", projectRoot, "bun --cpu-prof without --cpu-prof-dir writes to cwd")
      );
      continue;
    }

    if (name.endsWith(".bak") && stat.isFile()) {
      items.push(item(name, "backup", projectRoot, "backup file"));
    }
  }

  const dxDir = join(projectRoot, "dx");
  if (pathExists(dxDir) && pathStat(dxDir).isDirectory() && listDir(dxDir).length === 0) {
    items.push(item("dx", "empty-dir", projectRoot, "empty dx/ stub"));
  }

  return items;
}

export function collectRootHygieneMisconfig(projectRoot: string): string[] {
  const hints: string[] = [];
  const envHint = envLiteralTildeCacheMisconfig();
  if (envHint) hints.push(envHint);

  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (pathExists(bunfigPath)) {
    const bunfigHint = bunfigLiteralTildeCacheMisconfig(readText(bunfigPath));
    if (bunfigHint) hints.push(bunfigHint);
  }
  return hints;
}

export async function auditRootHygiene(
  projectRoot: string,
  options: { dryRun?: boolean } = {}
): Promise<RootHygieneReport> {
  const items = collectRootHygieneItems(projectRoot);
  const misconfig = collectRootHygieneMisconfig(projectRoot);

  return {
    projectRoot,
    dryRun: options.dryRun ?? false,
    items,
    totalBytes: items.reduce((sum, i) => sum + i.bytes, 0),
    totalFiles: items.reduce((sum, i) => sum + i.fileCount, 0),
    misconfig,
  };
}

export function applyRootHygieneCleanup(report: RootHygieneReport): void {
  if (report.dryRun) return;
  for (const entry of report.items) {
    removePath(join(report.projectRoot, entry.relPath), { recursive: true, force: true });
  }
}
