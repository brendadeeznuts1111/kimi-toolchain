/**
 * Repo-root artifact hygiene — stray Bun cache dirs, profiles, and CPU captures.
 *
 * Bun 1.4.0 treats `~` literally in `[install.cache].dir` and `BUN_INSTALL_CACHE_DIR`
 * @see https://bun.com/docs/pm/global-cache
 */

import { join } from "path";
import { listDir, pathExists, pathStat, readText, removePath, writeText } from "./bun-io.ts";
import { countTree } from "./hygiene-utils.ts";
import { homeDir } from "./paths.ts";

/** Default CPU/heap profile output under the project (gitignored via .kimi-artifacts/). */
export const DEFAULT_PROFILE_OUTPUT_DIR = ".kimi-artifacts/profiles";

export type RootHygieneKind =
  | "literal-tilde-dir"
  | "cpuprofile"
  | "profiles-dir"
  | "bun-build"
  | "tmpdir"
  | "backup"
  | "empty-dir";

export interface RootHygieneItem {
  relPath: string;
  kind: RootHygieneKind;
  bytes: number;
  fileCount: number;
  cause: string;
  /** When grouped (e.g. many *.bun-build), delete these paths instead of relPath. */
  removePaths?: string[];
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

/** Remove literal-tilde `[install.cache].dir` line from bunfig text. */
export function stripBunfigLiteralTildeCacheDir(bunfigText: string): string {
  if (!bunfigLiteralTildeCacheDir(bunfigText)) return bunfigText;
  const lines = bunfigText.split("\n");
  const out: string[] = [];
  let inCache = false;
  let stripped = false;
  for (const line of lines) {
    if (line.trim() === "[install.cache]") {
      inCache = true;
      out.push(line);
      if (!stripped && !out.some((l) => l.includes("Omit `dir`"))) {
        out.push(
          "# Omit dir — Bun default is ~/.bun/install/cache; tilde in dir is literal on Bun 1.4.0"
        );
      }
      continue;
    }
    if (inCache && /^\s*dir\s*=\s*"~\//.test(line)) {
      stripped = true;
      continue;
    }
    if (inCache && line.startsWith("[")) inCache = false;
    out.push(line);
  }
  return out.join("\n");
}

export function fixBunfigCacheMisconfig(projectRoot: string): boolean {
  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (!pathExists(bunfigPath)) return false;
  const text = readText(bunfigPath);
  if (!bunfigLiteralTildeCacheDir(text)) return false;
  writeText(bunfigPath, stripBunfigLiteralTildeCacheDir(text));
  return true;
}

export function suggestedInstallCacheEnvExport(home = homeDir()): string {
  return `export BUN_INSTALL_CACHE_DIR="${join(home, ".bun/install/cache")}"`;
}

/** Expand or drop literal-tilde BUN_INSTALL_CACHE_DIR so Bun does not write `./~/`. */
export function applyBunInstallCacheEnvSanitizer(
  env: Record<string, string>,
  home = homeDir()
): boolean {
  const raw = env.BUN_INSTALL_CACHE_DIR;
  if (!isLiteralTildeCachePath(raw)) return false;
  const expanded = expandInstallCacheDir(raw, home);
  if (expanded) env.BUN_INSTALL_CACHE_DIR = expanded;
  else delete env.BUN_INSTALL_CACHE_DIR;
  return true;
}

/** Fix current process env when IDE/shell injected a literal-tilde cache path. */
export function scrubProcessBunInstallCacheEnv(home = homeDir()): boolean {
  const raw = Bun.env.BUN_INSTALL_CACHE_DIR;
  if (!isLiteralTildeCachePath(raw)) return false;
  const expanded = expandInstallCacheDir(raw, home);
  if (expanded) Bun.env.BUN_INSTALL_CACHE_DIR = expanded;
  else delete Bun.env.BUN_INSTALL_CACHE_DIR;
  return true;
}

/** True when a Bun binary path points at an ephemeral bun-node-* install. */
export function isEphemeralBunNodeExecutable(path: string): boolean {
  return path.includes("bun-node-");
}

/** Prefer ~/.bun/bin/bun over ephemeral bun-node-* process.execPath (avoids ELOOP spawns). */
export function probeBunExecutable(home = homeDir()): string {
  const stable = join(home, ".bun", "bin", "bun");
  if (pathExists(stable)) return stable;
  const exec = process.execPath;
  if (!isEphemeralBunNodeExecutable(exec)) return exec;
  return stable;
}

/** Drop ephemeral bun-node-* PATH segments that can circular-link under parallel gates. */
export function sanitizeGatePath(pathValue: string | undefined, home = homeDir()): string {
  const bunBin = join(home, ".bun", "bin");
  const segments = (pathValue ?? "")
    .split(":")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !segment.includes("bun-node-"));
  if (!segments.includes(bunBin)) segments.unshift(bunBin);
  return segments.join(":");
}

/** Remove ephemeral bun-node-* dirs that can circular-link under parallel Bun spawns. */
export function scrubEphemeralBunNodeDirs(base = Bun.env.TMPDIR || Bun.env.TEMP || "/tmp"): number {
  let removed = 0;
  try {
    for (const name of listDir(base)) {
      if (!name.startsWith("bun-node-")) continue;
      removePath(join(base, name), { recursive: true, force: true });
      removed++;
    }
  } catch {
    /* tmp unreadable */
  }
  return removed;
}

/** Apply install-cache + PATH hygiene to a gate subprocess env. */
export function gateSpawnEnv(
  base: Record<string, string | undefined> = Bun.env,
  home = homeDir()
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ) as Record<string, string>;
  applyBunInstallCacheEnvSanitizer(env, home);
  env.PATH = sanitizeGatePath(env.PATH, home);
  return env;
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

  const bunBuildPaths: string[] = [];
  let bunBuildBytes = 0;
  for (const name of listDir(projectRoot)) {
    if (!name.includes(".bun-build")) continue;
    const full = join(projectRoot, name);
    try {
      if (!pathStat(full).isFile()) continue;
      bunBuildPaths.push(name);
      bunBuildBytes += pathStat(full).size;
    } catch {
      /* skip */
    }
  }
  if (bunBuildPaths.length > 0) {
    items.push({
      relPath: `*.bun-build (${bunBuildPaths.length})`,
      kind: "bun-build",
      bytes: bunBuildBytes,
      fileCount: bunBuildPaths.length,
      cause: "bun build --compile intermediates left in repo root",
      removePaths: bunBuildPaths,
    });
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
  if (envHint) {
    hints.push(envHint);
    hints.push(`fix shell: unset BUN_INSTALL_CACHE_DIR  # or ${suggestedInstallCacheEnvExport()}`);
  }

  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (pathExists(bunfigPath)) {
    const bunfigHint = bunfigLiteralTildeCacheMisconfig(readText(bunfigPath));
    if (bunfigHint) {
      hints.push(bunfigHint);
      hints.push("fix repo: bun run cleanup:root -- --fix-bunfig");
    }
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
    const paths = entry.removePaths?.map((rel) => join(report.projectRoot, rel)) ?? [
      join(report.projectRoot, entry.relPath),
    ];
    for (const path of paths) {
      removePath(path, { recursive: true, force: true });
    }
  }
}
