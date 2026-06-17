/**
 * Watch-mode helpers for scripts/check.ts (fs watcher lives in scripts/).
 */

import type { CheckOptions } from "./check-types.ts";

const WATCH_DIRS = ["src", "scripts", "test"] as const;

function watchOut(message: string): void {
  Bun.stdout.write(`${message}\n`);
}

export function mergeWatchOptions(base: CheckOptions): CheckOptions {
  return {
    ...base,
    watch: false,
    watchTests: false,
    fast: true,
    changedOnly: true,
    failFast: true,
  };
}

/** Test-only TDD loop: changed tests via bun --changed, no format/lint/typecheck. */
export function mergeWatchTestsOptions(base: CheckOptions): CheckOptions {
  return {
    ...base,
    watch: false,
    watchTests: false,
    fast: true,
    changedOnly: true,
    failFast: false,
    skipTests: false,
  };
}

export function printWatchDryRun(): void {
  watchOut("watch — dry run");
  watchOut(`  dirs: ${WATCH_DIRS.join(", ")}`);
  watchOut("  debounce: 300ms");
  watchOut("  implied flags: --fast --changed-only --fail-fast");
  watchOut("  respects explicit flags (e.g. --skip-tests)");
}

export function printWatchTestsDryRun(): void {
  watchOut("watch-tests — dry run");
  watchOut(`  dirs: ${WATCH_DIRS.join(", ")}`);
  watchOut("  debounce: 300ms");
  watchOut("  implied flags: --fast --changed-only (test step only)");
  watchOut("  tests: bun test --changed=<base>");
}
