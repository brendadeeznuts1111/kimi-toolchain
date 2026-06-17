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
}

const FORMAT_ROOTS = ["src", "scripts", "test", "skills", "templates", "src/install-hooks"];

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
  if (!options.changedOnly) return { changedFiles: null, baseRef: null };
  const baseRef = await resolveBaseRef(projectRoot, options.base);
  if (!baseRef) {
    throw new Error(`Could not resolve base ref for --changed-only (base=${options.base})`);
  }
  const changedFiles = await listChangedFiles(projectRoot, baseRef);
  return { changedFiles, baseRef };
}
