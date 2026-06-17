/**
 * Scoped lint helpers for scripts/check.ts --changed-only.
 * Aligns iterate lint with hook checks that are file-local and fast.
 */

import { filterLintPaths } from "./check-changed.ts";

/** Full-repo lint steps skipped in scoped mode (still run via bun run lint / pre-commit). */
export const FULL_LINT_ONLY_CHECKS = [
  "bun-native-lint",
  "context-bloat",
  "skill-coverage",
  "tochange",
  "test-conventions",
  "build-constants",
  "constants-manifest",
  "canonical-references",
  "constant-parity",
  "cli-contract",
  "dx:table:contract",
] as const;

export function filterBannedTermPaths(changed: string[]): string[] {
  return changed.filter((path) => {
    if (path === "bun.lock") return false;
    return /\.(md|ts|json|toml)$/.test(path);
  });
}

export function filterPatternPaths(changed: string[]): string[] {
  return changed.filter(
    (path) => path.startsWith("src/") && path.endsWith(".ts") && !path.includes("/node_modules/")
  );
}

export function filterChangedTestPaths(changed: string[]): string[] {
  return changed.filter((path) => path.startsWith("test/") && path.endsWith(".test.ts"));
}

/** Whether scoped lint should run (oxlint and/or companion file checks). */
export function shouldRunScopedLint(changed: string[]): boolean {
  return (
    filterLintPaths(changed).length > 0 ||
    filterBannedTermPaths(changed).length > 0 ||
    filterChangedTestPaths(changed).length > 0
  );
}

export function scopedLintNoticeLine(): string {
  const skipped = FULL_LINT_ONLY_CHECKS.join(", ");
  return `ℹ lint (scoped): oxlint + banned-terms + patterns + test-names on changed files; skipped full lint: ${skipped}`;
}

export function printScopedLintNotice(): void {
  Bun.stdout.write(`${scopedLintNoticeLine()}\n`);
}
