/**
 * Test gate configuration — fast unit vs full smoke suites.
 * @see https://bun.com/docs/guides/test/timeout
 */

/** Pure unit tests (no subprocess smoke); safe at --timeout 100 */
export const UNIT_TEST_FILES = [
  "test/lib.unit.test.ts",
  "test/r-score.unit.test.ts",
  "test/sync.unit.test.ts",
  "test/desktop-sync.unit.test.ts",
  "test/doctor-runs.unit.test.ts",
] as const;

export const FAST_TEST_TIMEOUT_MS = 100;
export const DEFAULT_TEST_TIMEOUT_MS = 5000;
export const SMOKE_TEST_TIMEOUT_MS = 60_000;

export function bunTestArgs(options: {
  coverage?: boolean;
  json?: boolean;
  fast?: boolean;
  timeoutMs?: number;
}): string[] {
  const timeout = String(
    options.timeoutMs ?? (options.fast ? FAST_TEST_TIMEOUT_MS : DEFAULT_TEST_TIMEOUT_MS)
  );
  const args = ["test", "--timeout", timeout];
  if (options.coverage) args.push("--coverage");
  if (options.json) args.push("--json");
  if (options.fast) {
    args.push(...UNIT_TEST_FILES);
  }
  return args;
}

export function useFastUnitCoverage(packageName: string | undefined): boolean {
  return packageName === "kimi-toolchain";
}
