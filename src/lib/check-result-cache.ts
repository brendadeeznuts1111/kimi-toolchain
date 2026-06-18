/**
 * Result cache for scripts/check.ts --cache-results (.kimi/gate-cache.json).
 * Supports multiple projects in one cache file via package-scoped keys.
 */

import { $ } from "bun";
import { join } from "path";
import { makeDir, pathExists } from "./bun-io.ts";
import { safeParse } from "./utils.ts";
import { type CheckOptions, type CheckRunResult, optionsFingerprint } from "./check-types.ts";

/** Only cache successful runs — failed results would poison later cache hits on the same key. */
export function shouldPersistCheckCache(result: CheckRunResult): boolean {
  return result.passed;
}

const CACHE_RELATIVE = ".kimi/gate-cache.json";
const CACHE_VERSION = 2;

/** Tooling/config files that affect gate behavior — included in cache key hash. */
const TOOLING_FILES = [
  "dx.config.toml",
  "scripts/check.ts",
  "package.json",
  ".oxfmtrc.json",
  "tsconfig.json",
  "bunfig.toml",
];

interface CachedCheckPayload {
  key: string;
  result: CheckRunResult;
  timestamp: number;
}

interface GateCacheFileV2 {
  version: 2;
  entries: Record<string, CachedCheckPayload>;
}

/** Legacy single-project cache shape (pre v2). */
interface GateCacheFileLegacy {
  key?: string;
  result?: CheckRunResult;
  timestamp?: number;
}

export function checkCachePath(projectRoot: string): string {
  return join(projectRoot, CACHE_RELATIVE);
}

export async function projectScopeKey(projectRoot: string): Promise<string> {
  const pkgPath = join(projectRoot, "package.json");
  if (pathExists(pkgPath)) {
    const pkg = safeParse<{ name?: string } | null>(await Bun.file(pkgPath).text(), null);
    if (pkg?.name && typeof pkg.name === "string") return pkg.name;
  }
  return Bun.hash(projectRoot).toString(16).slice(0, 12);
}

async function hashTrackedFiles(projectRoot: string): Promise<string> {
  const listResult = await $`git ls-files src scripts test`.cwd(projectRoot).nothrow().quiet();
  const tracked =
    listResult.exitCode === 0
      ? listResult.stdout
          .toString()
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

  const allPaths = [...tracked, ...TOOLING_FILES];
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of allPaths) {
    const path = join(projectRoot, file);
    if (!pathExists(path)) continue;
    hasher.update(file);
    hasher.update(await Bun.file(path).arrayBuffer());
  }
  return hasher.digest("hex").slice(0, 12);
}

export async function computeCheckCacheKey(
  projectRoot: string,
  options: CheckOptions
): Promise<string | null> {
  const headResult = await $`git rev-parse HEAD`.cwd(projectRoot).nothrow().quiet();
  if (headResult.exitCode !== 0) return null;
  const commit = headResult.stdout.toString().trim();
  if (!commit) return null;

  const filesHash = await hashTrackedFiles(projectRoot);
  return `${commit}-${filesHash}-${optionsFingerprint(options)}`;
}

async function readCacheFile(projectRoot: string): Promise<GateCacheFileV2 | null> {
  const path = checkCachePath(projectRoot);
  if (!pathExists(path)) return null;
  const parsed = safeParse<GateCacheFileV2 | GateCacheFileLegacy | null>(
    await Bun.file(path).text(),
    null
  );
  if (!parsed || typeof parsed !== "object") return null;
  if ("version" in parsed && parsed.version === 2 && "entries" in parsed && parsed.entries) {
    return parsed as GateCacheFileV2;
  }
  return null;
}

export async function loadCheckCache(
  projectRoot: string,
  key: string
): Promise<CheckRunResult | null> {
  const scopeKey = await projectScopeKey(projectRoot);
  const file = await readCacheFile(projectRoot);
  if (!file?.entries[scopeKey]) return null;
  const entry = file.entries[scopeKey];
  if (!entry?.key || entry.key !== key || !entry.result) return null;
  return { ...entry.result, fromCache: true };
}

export async function saveCheckCache(
  projectRoot: string,
  key: string,
  result: CheckRunResult
): Promise<void> {
  const scopeKey = await projectScopeKey(projectRoot);
  const { fromCache: _, ...clean } = result;
  const payload: CachedCheckPayload = {
    key,
    result: clean,
    timestamp: Date.now(),
  };

  const existing = await readCacheFile(projectRoot);
  const file: GateCacheFileV2 = existing ?? { version: CACHE_VERSION, entries: {} };
  file.entries[scopeKey] = payload;

  makeDir(join(projectRoot, ".kimi"), { recursive: true });
  await Bun.write(checkCachePath(projectRoot), `${JSON.stringify(file)}\n`);
}
