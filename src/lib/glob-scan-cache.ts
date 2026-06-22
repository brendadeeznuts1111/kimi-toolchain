/**
 * glob-scan-cache.ts — Sentinel-backed cache for fs.glob file lists.
 */
import { join } from "path";

export interface GlobScanSentinels {
  packageJson: number;
  src: number;
  scripts: number;
}

export interface GlobScanCacheEntry {
  version: 1;
  sentinels: GlobScanSentinels;
  patterns: readonly string[];
  exclude: readonly string[];
  files: string[];
}

const CACHE_VERSION = 1 as const;

export function defaultGlobScanCachePath(cwd: string): string {
  return join(cwd, ".kimi", "glob-scan-cache.json");
}

function sentinelMtime(path: string): number {
  try {
    return Bun.file(path).lastModified;
  } catch {
    return 0;
  }
}

export function globScanSentinels(cwd: string): GlobScanSentinels {
  return {
    packageJson: sentinelMtime(join(cwd, "package.json")),
    src: sentinelMtime(join(cwd, "src")),
    scripts: sentinelMtime(join(cwd, "scripts")),
  };
}

export function sentinelsMatch(a: GlobScanSentinels, b: GlobScanSentinels): boolean {
  return a.packageJson === b.packageJson && a.src === b.src && a.scripts === b.scripts;
}

export async function loadGlobScanCache(
  cachePath: string,
  patterns: readonly string[],
  exclude: readonly string[]
): Promise<GlobScanCacheEntry | null> {
  const file = Bun.file(cachePath);
  if (!(await file.exists())) return null;
  try {
    const parsed = (await file.json()) as GlobScanCacheEntry;
    if (parsed?.version !== CACHE_VERSION) return null;
    if (JSON.stringify(parsed.patterns) !== JSON.stringify(patterns)) return null;
    if (JSON.stringify(parsed.exclude) !== JSON.stringify(exclude)) return null;
    if (!Array.isArray(parsed.files) || !parsed.sentinels) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveGlobScanCache(
  cachePath: string,
  entry: Omit<GlobScanCacheEntry, "version">
): Promise<void> {
  const payload: GlobScanCacheEntry = { version: CACHE_VERSION, ...entry };
  await Bun.write(cachePath, `${JSON.stringify(payload)}\n`);
}
