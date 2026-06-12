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
