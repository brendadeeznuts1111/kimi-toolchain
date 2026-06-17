/**
 * Scoped gate pass cache — bridges check:fast --changed-only and pre-commit hooks.
 * Stored at .kimi/.last-good-scoped-gates (per-gate file sets + branch diff scope).
 */

import { join } from "path";
import { makeDir, pathExists } from "./bun-io.ts";
import { safeParse } from "./utils.ts";
import { currentGitHead, shouldSkipGate } from "./gate-runner.ts";

const CACHE_RELATIVE = ".kimi/.last-good-scoped-gates";

/** Typecheck scoped pass marker — skip when staged ⊆ branchDiffFiles. */
export const SCOPED_ANY_TS = "*";

export interface ScopedGateEntry {
  files: string[];
  filesHash: string;
}

export interface ScopedGateCacheFile {
  commit: string;
  baseRef: string;
  branchDiffFiles: string[];
  branchDiffHash: string;
  gates: Record<string, ScopedGateEntry>;
  timestamp: number;
}

export function scopedGateCachePath(projectRoot: string): string {
  return join(projectRoot, CACHE_RELATIVE);
}

export function hashFileSet(files: string[]): string {
  const sorted = [...new Set(files)].sort();
  if (sorted.length === 0) return "empty";
  return Bun.hash(sorted.join("\n")).toString(16).slice(0, 12);
}

export function isFileSetSubset(subset: string[], superset: string[]): boolean {
  if (subset.length === 0) return true;
  const set = new Set(superset);
  return subset.every((file) => set.has(file));
}

export async function readScopedGateCache(
  projectRoot: string
): Promise<ScopedGateCacheFile | null> {
  const path = scopedGateCachePath(projectRoot);
  if (!pathExists(path)) return null;
  const parsed = safeParse<ScopedGateCacheFile | null>(await Bun.file(path).text(), null);
  if (!parsed?.commit || !parsed.baseRef || !Array.isArray(parsed.branchDiffFiles)) return null;
  if (!parsed.gates || typeof parsed.gates !== "object") return null;
  return parsed;
}

export async function writeScopedGatePass(
  projectRoot: string,
  gateName: string,
  gateFiles: string[],
  baseRef: string,
  branchDiffFiles: string[]
): Promise<void> {
  const commit = await currentGitHead(projectRoot);
  if (!commit) return;

  const gateUnique = [...new Set(gateFiles)].sort();
  const branchUnique = [...new Set(branchDiffFiles)].sort();
  const entry: ScopedGateEntry = {
    files: gateUnique,
    filesHash: hashFileSet(gateUnique),
  };

  const existing = await readScopedGateCache(projectRoot);
  const file: ScopedGateCacheFile =
    existing?.commit === commit
      ? {
          ...existing,
          baseRef,
          branchDiffFiles: branchUnique,
          branchDiffHash: hashFileSet(branchUnique),
          gates: { ...existing.gates, [gateName]: entry },
          timestamp: Date.now(),
        }
      : {
          commit,
          baseRef,
          branchDiffFiles: branchUnique,
          branchDiffHash: hashFileSet(branchUnique),
          gates: { [gateName]: entry },
          timestamp: Date.now(),
        };

  makeDir(join(projectRoot, ".kimi"), { recursive: true });
  await Bun.write(scopedGateCachePath(projectRoot), `${JSON.stringify(file)}\n`);
}

/**
 * Pre-commit skip when scoped gate passed at HEAD and staged paths ⊆ cached scope.
 */
export async function shouldSkipGateFromScopedCache(
  projectRoot: string,
  gateName: string,
  stagedPaths: string[]
): Promise<boolean> {
  const head = await currentGitHead(projectRoot);
  if (!head) return false;
  const cache = await readScopedGateCache(projectRoot);
  if (!cache || cache.commit !== head) return false;
  const entry = cache.gates[gateName];
  if (!entry) return false;
  if (entry.files.includes(SCOPED_ANY_TS)) {
    return isFileSetSubset(stagedPaths, cache.branchDiffFiles);
  }
  return isFileSetSubset(stagedPaths, entry.files);
}

/** Pre-push / coverage check: full legacy pass or scoped pass recorded at HEAD. */
export async function isGateCoveredAtHead(projectRoot: string, gateName: string): Promise<boolean> {
  if (await shouldSkipGate(projectRoot, gateName)) return true;
  const head = await currentGitHead(projectRoot);
  if (!head) return false;
  const cache = await readScopedGateCache(projectRoot);
  return cache?.commit === head && cache.gates[gateName] !== undefined;
}

export const PRE_COMMIT_SCOPED_GATES = ["format:check", "lint", "typecheck", "test:fast"] as const;

export async function allPreCommitGatesCoveredAtHead(projectRoot: string): Promise<boolean> {
  for (const gate of PRE_COMMIT_SCOPED_GATES) {
    if (!(await isGateCoveredAtHead(projectRoot, gate))) return false;
  }
  return true;
}
