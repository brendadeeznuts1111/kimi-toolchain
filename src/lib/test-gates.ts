/**
 * Test gate configuration — fast unit vs full smoke suites.
 * @see https://bun.com/docs/guides/test/timeout
 * @see https://bun.com/docs/guides/test/bail
 * @see https://bun.com/docs/test/configuration
 */

/** Pure unit tests (no subprocess smoke); safe at --timeout 100 */
export const UNIT_TEST_FILES = [
  "test/lib.unit.test.ts",
  "test/r-score.unit.test.ts",
  "test/sync.unit.test.ts",
  "test/desktop-sync.unit.test.ts",
  "test/doctor-runs.db.test.ts",
  "test/test-gates.unit.test.ts",
  "test/sync-drift.unit.test.ts",
  "test/readme-sync.unit.test.ts",
  "test/path-alignment.unit.test.ts",
  "test/mcp-config.unit.test.ts",
  "test/kimi-config-audit.unit.test.ts",
  "test/scaffold-agents.unit.test.ts",
  "test/scaffold-templates.unit.test.ts",
  "test/scaffold-aligned.unit.test.ts",
  "test/workspace-health.test.ts",
  "test/ecosystem-health.test.ts",
  "test/governance-check.unit.test.ts",
  "test/conventional-commits.unit.test.ts",
  "test/changelog.unit.test.ts",
  "test/scaffold-quality.unit.test.ts",
  "test/cloudflare-access.unit.test.ts",
  "test/cloudflare-access-dashboard.unit.test.ts",
  "test/cloudflare-access-policy.unit.test.ts",
  "test/tool-runner.unit.test.ts",
  "test/tool-registry.unit.test.ts",
  "test/provider-contract.unit.test.ts",
  "test/success-metrics.unit.test.ts",
  "test/kimi-toolchain.router.test.ts",
  "test/unified-shell-bridge.unit.test.ts",
  "test/error-taxonomy.unit.test.ts",
  "test/health-check.unit.test.ts",
  "test/logger.unit.test.ts",
  "test/telemetry-schema.unit.test.ts",
  "test/doctor-pipeline.unit.test.ts",
  "test/effect/tool-runner-effect.unit.test.ts",
  "test/effect/cli-runtime.unit.test.ts",
] as const;

/** Smoke tests — full CLI invocations, 15-30s each */
export const SMOKE_TEST_FILES = ["test/smoke/kimi-doctor.smoke.test.ts"] as const;

export const FAST_TEST_TIMEOUT_MS = 500;
export const DEFAULT_TEST_TIMEOUT_MS = 5000;
export const CI_TEST_TIMEOUT_MS = 60_000;
export const SMOKE_TEST_TIMEOUT_MS = 60_000;

export function bunTestArgs(options: {
  coverage?: boolean;
  json?: boolean;
  fast?: boolean;
  ci?: boolean;
  smoke?: boolean;
  bail?: boolean | number;
  timeoutMs?: number;
}): string[] {
  const timeout = String(
    options.timeoutMs ??
      (options.fast
        ? FAST_TEST_TIMEOUT_MS
        : options.ci
          ? CI_TEST_TIMEOUT_MS
          : DEFAULT_TEST_TIMEOUT_MS)
  );
  const args = ["test", "--timeout", timeout];
  if (options.bail) {
    args.push(typeof options.bail === "number" ? `--bail=${options.bail}` : "--bail");
  }
  if (options.coverage) args.push("--coverage");
  if (options.ci) {
    args.push("--reporter=junit", "--reporter-outfile=reports/junit.xml");
  }
  if (options.json) args.push("--json");
  if (options.fast) {
    args.push(...UNIT_TEST_FILES);
  }
  if (options.smoke) {
    args.push(...SMOKE_TEST_FILES);
  }
  return args;
}

export function useFastUnitCoverage(packageName: string | undefined): boolean {
  return packageName === "kimi-toolchain";
}
