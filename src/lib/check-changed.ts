/**
 * Changed-file resolution for scripts/check.ts --changed-only.
 */

import { $ } from "bun";
import { pathExists } from "./bun-io.ts";
import { join } from "path";
import type { CheckOptions } from "./check-types.ts";
import { UNIT_TEST_FILES } from "./test-gates.ts";

export interface ChangedContext {
  changedFiles: string[] | null;
  baseRef: string | null;
  /** Display label for dry-run / banners (may differ from options.base after fallback). */
  baseLabel: string | null;
}

const FORMAT_ROOTS = ["src", "scripts", "test", "skills", "templates", "src/install-hooks"];

/** When primary base has no diff (e.g. on main tip), try these before giving up. */
const AUTO_FALLBACK_BASES = ["origin/main", "main"] as const;

export async function resolveBaseRef(projectRoot: string, base: string): Promise<string | null> {
  const candidates = [base, `origin/${base}`, `refs/remotes/origin/${base}`];
  for (const ref of candidates) {
    const result = await $`git rev-parse --verify ${ref}`.cwd(projectRoot).nothrow().quiet();
    if (result.exitCode === 0) return ref;
  }
  return null;
}

export async function listChangedFiles(projectRoot: string, baseRef: string): Promise<string[]> {
  const result = await $`git diff --name-only ${baseRef}...HEAD`.cwd(projectRoot).nothrow().quiet();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && pathExists(join(projectRoot, line)));
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

/** Heuristic fallback when bun test --changed is unavailable (non-git fixtures). */
export function filterRelatedUnitTests(changed: string[]): string[] {
  if (changed.length === 0) return [];

  const changedTests = changed.filter((path) => path.startsWith("test/") && path.endsWith(".ts"));
  const related = new Set<string>(changedTests);

  for (const path of changed) {
    const base =
      path
        .replace(/\.(ts|tsx|js|jsx)$/, "")
        .split("/")
        .pop() ?? "";
    if (!base) continue;
    for (const testFile of UNIT_TEST_FILES) {
      if (testFile.includes(base)) related.add(testFile);
    }
  }

  if (related.size === 0 && changedIncludesTypeScript(changed)) {
    return [...UNIT_TEST_FILES];
  }
  return [...related];
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

  const primaryRef = await resolveBaseRef(projectRoot, options.base);
  if (!primaryRef) {
    throw new Error(`Could not resolve base ref for --changed-only (base=${options.base})`);
  }

  let baseRef = primaryRef;
  let changedFiles = await listChangedFiles(projectRoot, baseRef);
  let baseLabel = options.base;

  if (changedFiles.length === 0 && !options.baseExplicit) {
    const tried = new Set<string>([primaryRef]);
    for (const candidate of AUTO_FALLBACK_BASES) {
      if (candidate === options.base) continue;
      const fallbackRef = await resolveBaseRef(projectRoot, candidate);
      if (!fallbackRef || tried.has(fallbackRef)) continue;
      tried.add(fallbackRef);
      const fallbackChanged = await listChangedFiles(projectRoot, fallbackRef);
      if (fallbackChanged.length > 0) {
        baseRef = fallbackRef;
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
