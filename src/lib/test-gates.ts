/**
 * Test gate configuration — fast unit vs full smoke suites.
 * @see https://bun.com/docs/guides/test/timeout
 * @see https://bun.com/docs/guides/test/bail
 * @see https://bun.com/docs/test/configuration
 */

/** Pure unit tests (no subprocess smoke); safe at the fast timeout. */
export const UNIT_TEST_FILES = [
  "test/lib.unit.test.ts",
  "test/r-score.unit.test.ts",
  "test/sync.unit.test.ts",
  "test/desktop-sync.unit.test.ts",
  "test/doctor-runs.db.test.ts",
  "test/test-gates.unit.test.ts",
  "test/sync-drift.unit.test.ts",
  "test/readme-sync.unit.test.ts",
  "test/context-bloat-lint.unit.test.ts",
  "test/bun-native-lint.unit.test.ts",
  "test/path-alignment.unit.test.ts",
  "test/workspace-known-blockers.unit.test.ts",
  "test/mcp-config.unit.test.ts",
  "test/kimi-config-audit.unit.test.ts",
  "test/dx-github-alignment.unit.test.ts",
  "test/scaffold-agents.unit.test.ts",
  "test/scaffold-templates.unit.test.ts",
  "test/scaffold-doctor.unit.test.ts",
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
  "test/build-constants.unit.test.ts",
  "test/build-constants-registry.unit.test.ts",
  "test/taxonomy-constants.unit.test.ts",
  "test/error-suggest.unit.test.ts",
  "test/constant-optimizer.unit.test.ts",
  "test/optimizer-doctor.unit.test.ts",
  "test/hook-gates.unit.test.ts",
  "test/optimizer-health-trend.unit.test.ts",
  "test/decision-list-diff.unit.test.ts",
  "test/taxonomy-coverage.unit.test.ts",
  "test/quiet-mode.unit.test.ts",
  "test/gate-runner.unit.test.ts",
  "test/kimi-githooks.unit.test.ts",
  "test/identity-matrix.unit.test.ts",
  "test/lint-test-names.unit.test.ts",
  "test/tuning-set-version.unit.test.ts",
  "test/constants-heal.unit.test.ts",
  "test/effect/constants-registry.unit.test.ts",
  "test/decision-ledger.unit.test.ts",
  "test/doctor-pipeline.unit.test.ts",
  "test/effect/tool-runner-effect.unit.test.ts",
  "test/effect/cli-runtime.unit.test.ts",
  // herdr orchestration unit tests
  "test/herdr-orchestrator.unit.test.ts",
  "test/herdr-orchestrator-remote.unit.test.ts",
  "test/herdr-orchestrator-events.unit.test.ts",
  "test/herdr-project-cli.unit.test.ts",
  "test/herdr-project-config.unit.test.ts",
  "test/herdr-project-context.unit.test.ts",
  "test/herdr-project-layout.unit.test.ts",
  "test/herdr-project-reconcile.unit.test.ts",
  "test/herdr-role-tab.unit.test.ts",
  "test/herdr-doctor.unit.test.ts",
  "test/herdr-session-preflight.unit.test.ts",
  "test/herdr-test-agent.unit.test.ts",
  "test/herdr-tab-lifecycle.unit.test.ts",
  "test/herdr-pane-requires.unit.test.ts",
  "test/herdr-tool-health.unit.test.ts",
  "test/herdr-latm.unit.test.ts",
  "test/herdr-unix-socket.unit.test.ts",
  "test/herdr-workspace-match.unit.test.ts",
  "test/herdr-workspace-service.unit.test.ts",
  "test/handoff-log.unit.test.ts",
  "test/governance-preflight.unit.test.ts",
] as const;

/** Integration tests — included by full Bun discovery, not the fast unit gate. */
export const INTEGRATION_TEST_FILES = [
  "test/cleanup-legacy.integration.test.ts",
  "test/kimi-fix.integration.test.ts",
  "test/decision-scoring.integration.test.ts",
  "test/effect-gates.integration.test.ts",
] as const;

/** Smoke tests — full CLI invocations, 15-30s each */
export const SMOKE_TEST_FILES = [
  "test/smoke/kimi-doctor.smoke.test.ts",
  "test/smoke/kimi-identity.smoke.test.ts",
] as const;

export const FAST_TEST_TIMEOUT_MS = 1_500;
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;
export const CI_TEST_TIMEOUT_MS = 30_000;
export const SMOKE_TEST_TIMEOUT_MS = 60_000;

export function bunTestArgs(options: {
  coverage?: boolean;
  json?: boolean;
  fast?: boolean;
  ci?: boolean;
  integration?: boolean;
  smoke?: boolean;
  bail?: boolean | number;
  timeoutMs?: number;
  retry?: number;
  dots?: boolean;
}): string[] {
  const timeout = String(
    options.timeoutMs ??
      (options.fast
        ? FAST_TEST_TIMEOUT_MS
        : options.smoke
          ? SMOKE_TEST_TIMEOUT_MS
          : options.ci
            ? CI_TEST_TIMEOUT_MS
            : DEFAULT_TEST_TIMEOUT_MS)
  );
  const args = ["test", "--timeout", timeout];
  if (options.bail) {
    args.push(typeof options.bail === "number" ? `--bail=${options.bail}` : "--bail");
  }
  if (options.retry !== undefined && options.retry > 0) {
    args.push(`--retry=${options.retry}`);
  }
  if (options.coverage) args.push("--coverage");
  if (options.ci) {
    args.push("--reporter=junit", "--reporter-outfile=reports/junit.xml");
  }
  if (options.dots) args.push("--dots");
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
  return args;
}

export function useFastUnitCoverage(packageName: string | undefined): boolean {
  return packageName === "kimi-toolchain";
}
