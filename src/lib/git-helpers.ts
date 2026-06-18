/**
 * src/lib/git-helpers.ts
 *
 * Common git operations used across multiple CLI tools.
 * Wraps Bun's `$` template literal with consistent error handling.
 */

import { $ } from "bun";

/** Run git log with a custom format and optional range. Returns stdout text or empty string on failure. */
export async function gitLog(projectDir: string, format: string, range?: string): Promise<string> {
  const result = range
    ? await $`git log ${range} --format=${format}`.cwd(projectDir).nothrow().quiet()
    : await $`git log --format=${format}`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

/** Run git rev-parse with an argument. Returns stdout text or null on failure. */
export async function gitRevParse(projectDir: string, arg: string): Promise<string | null> {
  const result = await $`git rev-parse ${arg}`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
}

/** Get git status --porcelain output. Returns stdout text or empty string on failure. */
export async function gitStatus(projectDir: string): Promise<string> {
  const result = await $`git status --porcelain`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

/** Run git diff with arguments. Returns stdout text or empty string on failure. */
export async function gitDiff(projectDir: string, args: string[]): Promise<string> {
  const result = await $`git diff ${args}`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

/** Get the git remote URL for origin. Returns stdout text or null on failure. */
export async function gitRemoteUrl(projectDir: string): Promise<string | null> {
  const result = await $`git remote get-url origin`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
}

/** Get the current branch name. Returns stdout text or "unknown" on failure. */
export async function gitBranch(projectDir: string): Promise<string> {
  const result = await $`git branch --show-current`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() || "unknown" : "unknown";
}

/** Get the last commit message (subject only). Returns stdout text or empty string on failure. */
export async function gitLastCommitMessage(projectDir: string): Promise<string> {
  const result = await $`git log -1 --format=%s`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

/** Check if a directory is a git repository. */
export async function isGitRepo(projectDir: string): Promise<boolean> {
  const result = await $`git rev-parse --is-inside-work-tree`.cwd(projectDir).nothrow().quiet();
  return result.exitCode === 0 && result.stdout.toString().trim() === "true";
}

export interface WorktreeGuardResult {
  /** The actual repo root (resolved bypassing any stale core.worktree). */
  actualRoot: string;
  /** True when core.worktree was set and pointed elsewhere — now unset. */
  wasStale: boolean;
  /** The stale core.worktree value that was removed (if any). */
  stalePath?: string;
}

/**
 * Detect and repair stale core.worktree config.
 *
 * When core.worktree points to a temp directory (often left by test git repos or
 * concurrent hook runs), every git command sees the wrong working tree. This guard
 * detects the mismatch, unsets the stale value, and returns the real root.
 *
 * Call this at hook entry and before any git operation that depends on the
 * working tree being the actual repo.
 */
export async function ensureWorktreeClean(projectDir: string): Promise<WorktreeGuardResult> {
  // Check if core.worktree is set locally
  const wtResult = await $`git config --local core.worktree`.cwd(projectDir).nothrow().quiet();
  if (wtResult.exitCode !== 0) {
    // Not set — resolve actual root directly
    const rootResult = await $`git rev-parse --show-toplevel`.cwd(projectDir).nothrow().quiet();
    const actualRoot = rootResult.exitCode === 0 ? rootResult.stdout.toString().trim() : projectDir;
    return { actualRoot, wasStale: false };
  }

  const stalePath = wtResult.stdout.toString().trim();
  if (!stalePath) {
    const rootResult = await $`git rev-parse --show-toplevel`.cwd(projectDir).nothrow().quiet();
    const actualRoot = rootResult.exitCode === 0 ? rootResult.stdout.toString().trim() : projectDir;
    return { actualRoot, wasStale: false };
  }

  // Temporarily unset core.worktree to get the real root
  await $`git config --local --unset core.worktree`.cwd(projectDir).nothrow().quiet();

  const rootResult = await $`git rev-parse --show-toplevel`.cwd(projectDir).nothrow().quiet();
  const actualRoot = rootResult.exitCode === 0 ? rootResult.stdout.toString().trim() : projectDir;

  // Compare — if stalePath points to the same repo, restore it; otherwise leave unset
  const normalizedStale = await normalizePath(stalePath);
  const normalizedActual = await normalizePath(actualRoot);

  if (normalizedStale === normalizedActual) {
    // Same repo — restore the setting (it's valid, just explicit)
    await $`git config core.worktree ${stalePath}`.cwd(projectDir).nothrow().quiet();
    return { actualRoot, wasStale: false };
  }

  // Stale — stays unset
  return { actualRoot, wasStale: true, stalePath };
}

/** Resolve a path to its real (canonical) form, handling macOS /private/var vs /var. */
async function normalizePath(p: string): Promise<string> {
  try {
    return (await $`realpath ${p}`.nothrow().quiet()).stdout.toString().trim() || p;
  } catch {
    return p;
  }
}
