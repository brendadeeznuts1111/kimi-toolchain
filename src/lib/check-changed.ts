/**
 * Changed-file resolution for scripts/check.ts --changed-only.
 *
 * Uses native `bun test --changed=<ref>` (import-graph based) for test
 * scoping. Format and lint scoping still use `git diff --name-only`.
 */

import type { CheckOptions } from "./check-types.ts";

export interface ChangedContext {
  changedFiles: string[] | null;
  baseRef: string | null;
  /** Display label for dry-run / banners (may differ from options.base after fallback). */
  baseLabel: string | null;
}

const FORMAT_ROOTS = ["src", "scripts", "test", "skills", "templates", "src/install-hooks"];

/** When primary base has no diff (e.g. on main tip), try these before giving up. */
const AUTO_FALLBACK_BASES = ["origin/main", "main"] as const;

function gitDiffEnv(): Record<string, string> {
  const env = { ...Bun.env } as Record<string, string>;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

export async function listChangedFiles(projectRoot: string, baseRef: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "diff", "--name-only", `${baseRef}...HEAD`], {
    cwd: projectRoot,
    env: gitDiffEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) return [];
  const stdout = await new Response(proc.stdout).text();
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function filterFormatPaths(changed: string[]): string[] {
  return changed.filter((path) =>
    FORMAT_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
  );
}

export function changedIncludesTypeScript(changed: string[]): boolean {
  return changed.some((path) => /\.(ts|tsx|mts|cts)$/.test(path));
}

export function filterLintPaths(changed: string[]): string[] {
  return changed.filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path));
}

export function countLikelyErrors(
  name: string,
  stdout: string,
  stderr: string
): number | undefined {
  const text = `${stdout}\n${stderr}`;
  if (name === "typecheck") {
    const matches = text.match(/error TS\d+:/g);
    return matches?.length ?? undefined;
  }
  if (name === "lint") {
    const matches = text.match(/\berror\b/gi);
    return matches?.length ?? undefined;
  }
  if (name === "test" || name === "test:fast") {
    const fail = text.match(/(\d+)\s+fail/i);
    return fail ? Number(fail[1]) : undefined;
  }
  return undefined;
}

export async function resolveChangedContext(
  projectRoot: string,
  options: CheckOptions
): Promise<ChangedContext> {
  if (!options.changedOnly) {
    return { changedFiles: null, baseRef: null, baseLabel: null };
  }

  let baseRef = options.base;
  let changedFiles = await listChangedFiles(projectRoot, baseRef);
  let baseLabel = options.base;

  if (changedFiles.length === 0 && !options.baseExplicit) {
    for (const candidate of AUTO_FALLBACK_BASES) {
      if (candidate === options.base) continue;
      const fallbackChanged = await listChangedFiles(projectRoot, candidate);
      if (fallbackChanged.length > 0) {
        baseRef = candidate;
        changedFiles = fallbackChanged;
        baseLabel = `${options.base}→${candidate}`;
        break;
      }
    }
  }

  return { changedFiles, baseRef, baseLabel };
}

export function formatChangedOnlyBanner(changedFiles: string[], baseLabel: string): string {
  return `check: ${changedFiles.length} changed file(s) vs ${baseLabel}`;
}

export function formatChangedOnlyEmptyWarning(baseLabel: string): string {
  return `⚠ changed-only: 0 files vs ${baseLabel} — scoped hook cache will not update; try --base=origin/main or commit on a branch`;
}
