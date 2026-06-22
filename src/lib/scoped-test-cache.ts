/**
 * Scoped test pass cache — test:fast entries live in .last-good-scoped-gates.
 */

import { pathExists } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { GIT_LOCAL_ENV_KEYS } from "./tool-runner.ts";
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

const GIT_LOCAL_ENV_KEY_SET = new Set<string>(GIT_LOCAL_ENV_KEYS);

function scrubbedGitEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !GIT_LOCAL_ENV_KEY_SET.has(entry[0])
    )
  );
}

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
  const proc = Bun.spawn(["git", "diff", "--cached", "--name-only"], {
    cwd: projectRoot,
    env: scrubbedGitEnv(),
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([readableStreamToText(proc.stdout), proc.exited]);
  if (exitCode !== 0) return [];
  return stdout
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
