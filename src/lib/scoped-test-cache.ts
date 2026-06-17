/**
 * Scoped test pass cache — test:fast entries live in .last-good-scoped-gates.
 */

import { $ } from "bun";
import { pathExists } from "./bun-io.ts";
import {
  hashFileSet,
  isFileSetSubset,
  readScopedGateCache,
  scopedGateCachePath,
  shouldSkipGateFromScopedCache,
  writeScopedGatePass,
} from "./scoped-gate-cache.ts";

/** @deprecated Prefer scoped-gate-cache; kept for test imports. */
export interface ScopedTestCacheFile {
  commit: string;
  files: string[];
  filesHash: string;
  baseRef: string;
  timestamp: number;
}

export function scopedTestCachePath(projectRoot: string): string {
  return scopedGateCachePath(projectRoot);
}

export { hashFileSet, isFileSetSubset };

export async function readScopedTestCache(
  projectRoot: string
): Promise<ScopedTestCacheFile | null> {
  const cache = await readScopedGateCache(projectRoot);
  const entry = cache?.gates["test:fast"];
  if (!cache || !entry) return null;
  return {
    commit: cache.commit,
    files: entry.files.includes("*") ? cache.branchDiffFiles : entry.files,
    filesHash: entry.filesHash,
    baseRef: cache.baseRef,
    timestamp: cache.timestamp,
  };
}

export async function writeScopedTestCache(
  projectRoot: string,
  files: string[],
  baseRef: string
): Promise<void> {
  await writeScopedGatePass(projectRoot, "test:fast", files, baseRef, files);
}

export async function clearScopedTestCache(projectRoot: string): Promise<void> {
  const path = scopedGateCachePath(projectRoot);
  if (!pathExists(path)) return;
  await Bun.write(path, "");
}

/** Paths staged for commit (`git diff --cached --name-only`). */
export async function listStagedPaths(projectRoot: string): Promise<string[]> {
  const result = await $`git diff --cached --name-only`.cwd(projectRoot).nothrow().quiet();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function shouldSkipTestFastFromScopedCache(
  projectRoot: string,
  stagedPaths: string[]
): Promise<boolean> {
  return shouldSkipGateFromScopedCache(projectRoot, "test:fast", stagedPaths);
}
