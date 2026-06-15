/**
 * Test gate configuration — fast unit vs full smoke suites.
 * @see https://bun.com/docs/guides/test/timeout
 * @see https://bun.com/docs/guides/test/bail
 * @see https://bun.com/docs/test/configuration
 */

import { ARTIFACTS_COVERAGE_DIR, ARTIFACTS_REPORTS_DIR } from "./artifacts.ts";

/** Pure unit tests (no subprocess smoke); safe at the fast timeout below. */
export const UNIT_TEST_FILES = [
  "test/lib.unit.test.ts",
  "test/r-score.unit.test.ts",
  "test/sync.unit.test.ts",
  "test/desktop-sync.unit.test.ts",
  "test/doctor-runs.unit.test.ts",
  "test/test-gates.unit.test.ts",
  "test/agent-context-quality.unit.test.ts",
  "test/ci-impact.unit.test.ts",
  "test/ci-pipeline.unit.test.ts",
  "test/sync-drift.unit.test.ts",
  "test/readme-sync.unit.test.ts",
  "test/introspection-docs.unit.test.ts",
  "test/githook-templates.unit.test.ts",
  "test/path-alignment.unit.test.ts",
  "test/mcp-config.unit.test.ts",
  "test/kimi-config-audit.unit.test.ts",
  "test/scaffold-agents.unit.test.ts",
  "test/scaffold-templates.unit.test.ts",
  "test/scaffold-aligned.unit.test.ts",
  "test/workspace-health.unit.test.ts",
  "test/ecosystem-health.unit.test.ts",
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
  "test/contract-signing.unit.test.ts",
  "test/capabilities.unit.test.ts",
  "test/error-clustering.unit.test.ts",
  "test/ndjson.unit.test.ts",
  "test/self-healing.unit.test.ts",
  "test/decision-ledger.unit.test.ts",
  "test/success-metrics.unit.test.ts",
  "test/kimi-toolchain.router.unit.test.ts",
  "test/error-taxonomy.unit.test.ts",
  "test/health-check.unit.test.ts",
  "test/logger.unit.test.ts",
  "test/telemetry-schema.unit.test.ts",
  "test/doctor-pipeline.unit.test.ts",
  "test/effect/tool-runner-effect.unit.test.ts",
  "test/effect/cli-runtime.unit.test.ts",
  "test/effect/kimi-introspection-services.unit.test.ts",
] as const;

/** Smoke tests — full CLI invocations, 15-30s each */
export const SMOKE_TEST_FILES = ["test/smoke/kimi-doctor.smoke.test.ts"] as const;

/** Integration tests — slower filesystem/subprocess coverage but not full CLI smoke. */
export const INTEGRATION_TEST_FILES = [
  "test/cleanup-legacy.integration.test.ts",
  "test/error-clustering.integration.test.ts",
  "test/kimi-docs-aligned.integration.test.ts",
  "test/kimi-fix.integration.test.ts",
  "test/sync-manifest.integration.test.ts",
  "test/trace-ledger.integration.test.ts",
  "test/unified-shell-bridge.integration.test.ts",
] as const;

export const FAST_TEST_TIMEOUT_MS = 500;
export const DEFAULT_TEST_TIMEOUT_MS = 5000;
export const CI_TEST_TIMEOUT_MS = 60_000;
export const SMOKE_TEST_TIMEOUT_MS = 60_000;

export function bunTestArgs(options: {
  coverage?: boolean;
  json?: boolean;
  fast?: boolean;
  integration?: boolean;
  ci?: boolean;
  smoke?: boolean;
  files?: readonly string[];
  reporterOutfile?: string;
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
  if (options.coverage) args.push("--coverage", "--coverage-dir", ARTIFACTS_COVERAGE_DIR);
  if (options.ci) {
    args.push(
      "--reporter=junit",
      `--reporter-outfile=${options.reporterOutfile ?? `${ARTIFACTS_REPORTS_DIR}/junit.xml`}`
    );
  }
  if (options.json) args.push("--json");
  if (options.fast) {
    args.push(...UNIT_TEST_FILES);
  }
  if (options.integration) {
    args.push(...INTEGRATION_TEST_FILES);
  }
  if (options.smoke) {
    args.push(...SMOKE_TEST_FILES);
  }
  if (options.files) {
    args.push(...options.files);
  }
  return args;
}

export function useFastUnitCoverage(packageName: string | undefined): boolean {
  return packageName === "kimi-toolchain";
}
