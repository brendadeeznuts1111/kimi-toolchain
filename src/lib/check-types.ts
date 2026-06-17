/** Shared types for scripts/check.ts, cache, and watch modules. */

export interface CheckOptions {
  dryRun: boolean;
  fast: boolean;
  staged: boolean;
  verbose: boolean;
  timeoutMs: number;
  changedOnly: boolean;
  base: string;
  failFast: boolean;
  jsonSummary: boolean;
  skipTests: boolean;
  watch: boolean;
  watchTests: boolean;
  cacheResults: boolean;
  noCache: boolean;
}

export interface StepSummary {
  passed: boolean;
  durationMs: number;
  skipped?: boolean;
  errors?: number;
}

export interface CheckFailure {
  step: string;
  message: string;
}

export interface CheckRunResult {
  passed: boolean;
  steps: Record<string, StepSummary>;
  failures: CheckFailure[];
  totalDurationMs: number;
  fromCache?: boolean;
}

export function optionsFingerprint(options: CheckOptions): string {
  return JSON.stringify({
    fast: options.fast,
    changedOnly: options.changedOnly,
    base: options.base,
    skipTests: options.skipTests,
    staged: options.staged,
    timeoutMs: options.timeoutMs,
    failFast: options.failFast,
  });
}
