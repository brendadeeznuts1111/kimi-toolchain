/**
 * Path hygiene — scan arbitrary roots for Bun cache misconfig pollution and compile junk.
 *
 * Targets:
 *   - Literal `~` directories (Bun 1.4.0 does not expand tilde in cache paths)
 *   - `test-bun*` compile artifact directories left by bun build probes
 */

import { join, relative, resolve } from "path"; // @bun-native-exempt:soft-banned-import
import { listDir, pathExists, readText, removePath } from "./bun-io.ts";
import { countTree } from "./hygiene-utils.ts";
import { homeDir } from "./paths.ts";
import {
  collectRootHygieneMisconfig,
  type RootHygieneItem,
  auditRootHygiene,
  applyRootHygieneCleanup,
  type RootHygieneReport,
} from "./root-hygiene.ts";

export const PATH_HYGIENE_REPORT_SCHEMA_VERSION = 1;

export type PathHygieneKind = "literal-tilde-dir" | "test-bun-artifact" | RootHygieneItem["kind"];

export interface PathHygieneItem {
  /** Path relative to scan root. */
  relPath: string;
  kind: PathHygieneKind;
  bytes: number;
  fileCount: number;
  cause: string;
  absolutePath: string;
}

export interface PathHygieneReport {
  schemaVersion: number;
  scanRoot: string;
  dryRun: boolean;
  maxDepth: number;
  kinds: PathHygieneKind[];
  items: PathHygieneItem[];
  totalBytes: number;
  totalFiles: number;
  misconfig: string[];
  /** Present when scanRoot is a kimi-toolchain repo root. */
  repoRootHygiene?: RootHygieneReport;
}

export interface CollectPathHygieneOptions {
  scanRoot: string;
  maxDepth?: number;
  kinds?: PathHygieneKind[];
  /** Directory names to skip while walking (default PATH_HYGIENE_SKIP_DIRS). */
  skipDirs?: ReadonlySet<string>;
}

/** Heavy or sensitive trees — never descend during home-wide scans. */
export const PATH_HYGIENE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Library",
  "SecureArchives",
  "Pictures",
  "Movies",
  "Music",
  "Applications",
  ".Trash",
]);

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_KINDS: PathHygieneKind[] = ["literal-tilde-dir", "test-bun-artifact"];

function makeItem(
  scanRoot: string,
  absolutePath: string,
  kind: PathHygieneKind,
  cause: string
): PathHygieneItem {
  const { bytes, files } = countTree(absolutePath);
  return {
    relPath: relative(scanRoot, absolutePath) || absolutePath,
    kind,
    bytes,
    fileCount: files,
    cause,
    absolutePath,
  };
}

function shouldSkipDir(name: string, skipDirs: ReadonlySet<string>): boolean {
  return skipDirs.has(name);
}

function walkForPathHygiene(
  scanRoot: string,
  dir: string,
  depth: number,
  maxDepth: number,
  kinds: ReadonlySet<PathHygieneKind>,
  skipDirs: ReadonlySet<string>,
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

    if (name === "~" && kinds.has("literal-tilde-dir")) {
      items.push(
        makeItem(
          scanRoot,
          full,
          "literal-tilde-dir",
          "Bun 1.4.0 literal tilde cache dir — remove and fix BUN_INSTALL_CACHE_DIR / bunfig [install.cache].dir"
        )
      );
      continue;
    }

    if (kinds.has("test-bun-artifact") && name.startsWith("test-bun")) {
      items.push(
        makeItem(
          scanRoot,
          full,
          "test-bun-artifact",
          "Stale bun build probe output — safe to delete; regenerate with bun test/build"
        )
      );
      continue;
    }

    if (shouldSkipDir(name, skipDirs)) continue;
    walkForPathHygiene(scanRoot, full, depth + 1, maxDepth, kinds, skipDirs, items);
  }
}

/** Collect hygiene items under an arbitrary path (default: home). */
export function collectPathHygieneItems(options: CollectPathHygieneOptions): PathHygieneItem[] {
  const scanRoot = resolve(options.scanRoot);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const kinds = new Set(options.kinds ?? DEFAULT_KINDS);
  const skipDirs = options.skipDirs ?? PATH_HYGIENE_SKIP_DIRS;
  const items: PathHygieneItem[] = [];

  if (!pathExists(scanRoot)) return items;

  walkForPathHygiene(scanRoot, scanRoot, 0, maxDepth, kinds, skipDirs, items);
  return items.sort((a, b) => b.bytes - a.bytes);
}

async function repoRootHygieneIfApplicable(
  scanRoot: string
): Promise<RootHygieneReport | undefined> {
  const pkg = join(scanRoot, "package.json");
  if (!pathExists(pkg)) return undefined;
  try {
    const pkgJson = JSON.parse(readText(pkg)) as { name?: string };
    if (pkgJson.name !== "kimi-toolchain") return undefined;
  } catch {
    return undefined;
  }
  return auditRootHygiene(scanRoot, { dryRun: true });
}

/** Build a path hygiene report for a scan root. */
export async function auditPathHygiene(
  scanRoot: string,
  options: {
    dryRun?: boolean;
    maxDepth?: number;
    kinds?: PathHygieneKind[];
    skipDirs?: ReadonlySet<string>;
    includeRepoRoot?: boolean;
  } = {}
): Promise<PathHygieneReport> {
  const resolved = resolve(scanRoot);
  const kinds = options.kinds ?? DEFAULT_KINDS;
  const items = collectPathHygieneItems({
    scanRoot: resolved,
    maxDepth: options.maxDepth,
    kinds,
    skipDirs: options.skipDirs,
  });

  const misconfig = collectRootHygieneMisconfig(resolved);
  const includeRepo = options.includeRepoRoot ?? true;
  const repoRootHygiene =
    includeRepo && pathExists(join(resolved, "package.json"))
      ? await repoRootHygieneIfApplicable(resolved)
      : undefined;

  return {
    schemaVersion: PATH_HYGIENE_REPORT_SCHEMA_VERSION,
    scanRoot: resolved,
    dryRun: options.dryRun ?? false,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    kinds,
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles: items.reduce((sum, item) => sum + item.fileCount, 0),
    misconfig,
    repoRootHygiene,
  };
}

/** Default scan root: user home. */
export function defaultPathHygieneRoot(): string {
  return homeDir();
}

/** Remove items from a path hygiene report. */
export async function applyPathHygieneCleanup(report: PathHygieneReport): Promise<number> {
  if (report.dryRun) return 0;
  let removed = 0;
  for (const item of report.items) {
    try {
      removePath(item.absolutePath, { recursive: true, force: true });
      removed++;
    } catch {
      /* skip */
    }
  }

  if (report.repoRootHygiene && pathExists(join(report.scanRoot, "package.json"))) {
    const repoReport = await auditRootHygiene(report.scanRoot, { dryRun: false });
    applyRootHygieneCleanup(repoReport);
  }

  return removed;
}
