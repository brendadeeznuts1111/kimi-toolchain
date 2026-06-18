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
  "test/skill-contract.unit.test.ts",
  "test/skill-table.unit.test.ts",
  "test/frontmatter.unit.test.ts",
  "test/webview-console.unit.test.ts",
  "test/bun-image.unit.test.ts",
  "test/execve-handoff.unit.test.ts",
  "test/bun-markdown.unit.test.ts",
  "test/bun-install-config.unit.test.ts",
  "test/markdown-table.unit.test.ts",
  "test/table-schema.unit.test.ts",
  "test/url-decomposer.unit.test.ts",
  "test/property-table.unit.test.ts",
  "test/property-table-options.unit.test.ts",
  "test/toml-property-table.unit.test.ts",
  "test/property-table-renderer.unit.test.ts",
  "test/property-table-group.unit.test.ts",
  "test/property-table-describe.unit.test.ts",
  "test/property-table-metadata.unit.test.ts",
  "test/property-table-inventory.unit.test.ts",
  "test/skill-preview.unit.test.ts",
  "test/event-bus.unit.test.ts",
  "test/cache.unit.test.ts",
  "test/defaults-config.unit.test.ts",
  "test/herdr-dashboard-agents.unit.test.ts",
  "test/herdr-dashboard-discovery-cache.unit.test.ts",
  "test/herdr-dashboard-discovery-meta.unit.test.ts",
  "test/herdr-remote-host-probe.unit.test.ts",
  "test/herdr-dashboard-meta-gate.unit.test.ts",
  "test/herdr-dashboard-events.unit.test.ts",
  "test/herdr-dashboard-server.unit.test.ts",
  "test/herdr-dashboard-webview-store.unit.test.ts",
  "test/doc-links-lint.unit.test.ts",
  "test/herdr-dashboard-http3.unit.test.ts",
  "test/herdr-dashboard-cron.unit.test.ts",
  "test/herdr-dashboard-hub.unit.test.ts",
  "test/herdr-dashboard-widgets.unit.test.ts",
  "test/herdr-dashboard-widget-processes.unit.test.ts",
  "test/herdr-dashboard-widget-logs.unit.test.ts",
  "test/herdr-dashboard-widget-git.unit.test.ts",
  "test/herdr-dashboard-widget-processes-action.unit.test.ts",
  "test/herdr-dashboard-sessions.unit.test.ts",
  "test/herdr-dashboard-session-selector.unit.test.ts",
  "test/herdr-dashboard-watch.unit.test.ts",
  "test/herdr-dashboard-automation.unit.test.ts",
  "test/herdr-dashboard-automation-gate.unit.test.ts",
  "test/tochange-tracker.unit.test.ts",
  "test/bun-native-lint.unit.test.ts",
  "test/bun-spawn-env.unit.test.ts",
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
  "test/guardian-verify.unit.test.ts",
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
  "test/health-channel.unit.test.ts",
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
  "test/git-helpers.unit.test.ts",
  "test/kimi-githooks.unit.test.ts",
  "test/identity-matrix.unit.test.ts",
  "test/lint-test-names.unit.test.ts",
  "test/tuning-set-version.unit.test.ts",
  "test/trusted-dependencies.unit.test.ts",
  "test/constants-heal.unit.test.ts",
  "test/effect/constants-registry.unit.test.ts",
  "test/decision-ledger.unit.test.ts",
  "test/doctor-pipeline.unit.test.ts",
  "test/effect/tool-runner-effect.unit.test.ts",
  "test/effect/cli-runtime.unit.test.ts",
  "test/effect/dx-config.unit.test.ts",
  // herdr orchestration unit tests
  "test/herdr-orchestrator.unit.test.ts",
  "test/herdr-orchestrator-remote.unit.test.ts",
  "test/herdr-orchestrator-remote-discovery.unit.test.ts",
  "test/herdr-orchestrator-events.unit.test.ts",
  "test/herdr-socket-client.unit.test.ts",
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
  "test/herdr-socket-transport.unit.test.ts",
  "test/herdr-ws-unix.unit.test.ts",
  "test/herdr-workspace-match.unit.test.ts",
  "test/herdr-workspace-service.unit.test.ts",
  "test/handoff-log.unit.test.ts",
  "test/governor-config.unit.test.ts",
  "test/governor-spawn.unit.test.ts",
  "test/governance-preflight.unit.test.ts",
  "test/canonical-references.unit.test.ts",
  "test/config-status.unit.test.ts",
  "test/upgrade-advisor.unit.test.ts",
  "test/doctor-probe.unit.test.ts",
  "test/finish-work-herdr.unit.test.ts",
  "test/finish-work-report-schema.unit.test.ts",
  "test/context-sync-from-report.unit.test.ts",
  "test/condition-evaluator.unit.test.ts",
  "test/handoff-target-resolver.unit.test.ts",
  "test/scope-preflight.unit.test.ts",
  "test/hook-failure-text.unit.test.ts",
] as const;

/** Integration tests — included by full Bun discovery, not the fast unit gate. */
export const INTEGRATION_TEST_FILES = [
  "test/cleanup-legacy.integration.test.ts",
  "test/kimi-fix.integration.test.ts",
  "test/decision-scoring.integration.test.ts",
  "test/effect-gates.integration.test.ts",
  "test/config-status.integration.test.ts",
] as const;

/** Smoke tests — full CLI invocations, 15-30s each */
export const SMOKE_TEST_FILES = [
  "test/smoke/kimi-doctor.smoke.test.ts",
  "test/smoke/kimi-identity.smoke.test.ts",
  "test/smoke/herdr-orchestrator.smoke.test.ts",
  "test/smoke/finish-work-status.smoke.test.ts",
  "test/smoke/dx-table.smoke.test.ts",
  "test/smoke/config-status.smoke.test.ts",
] as const;

export const FAST_TEST_TIMEOUT_MS = 1_500;
export const DEFAULT_TEST_TIMEOUT_MS = 30_000;
export const CI_TEST_TIMEOUT_MS = 30_000;
export const SMOKE_TEST_TIMEOUT_MS = 60_000;

/** True when `bun test --changed` failed only because no test files matched the glob. */
export function isBunTestChangedEmptyOutput(output: string): boolean {
  return /No tests found/i.test(output) || /0 test files matching/i.test(output);
}

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
  /** Bun test --changed=<ref> — import-graph related tests vs a git ref */
  changedRef?: string;
  /** Bun test --parallel[=N] — run test files across N workers */
  parallel?: number | boolean;
  /** Bun test --shard=M/N — split test files across CI jobs */
  shard?: string;
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
  if (options.coverage) {
    args.push("--coverage", "--coverage-reporter=lcov", "--coverage-dir=./coverage");
  }
  if (options.ci) {
    args.push("--reporter=junit", "--reporter-outfile=reports/junit.xml");
  }
  if (options.dots) args.push("--dots");
  if (options.json) args.push("--json");
  if (options.changedRef) {
    args.push(`--changed=${options.changedRef}`);
  } else if (options.fast) {
    args.push("--isolate", ...UNIT_TEST_FILES);
  }
  if (options.integration) {
    args.push(...INTEGRATION_TEST_FILES);
  }
  if (options.smoke) {
    args.push("--isolate", ...SMOKE_TEST_FILES);
  }
  if (options.ci && !options.fast) {
    args.push("--isolate");
  }
  if (options.parallel !== undefined) {
    const n = options.parallel === true ? "" : `=${options.parallel}`;
    args.push(`--parallel${n}`, "--isolate");
  }
  if (options.shard) {
    args.push(`--shard=${options.shard}`, "--isolate");
  }
  return args;
}

export function useFastUnitCoverage(packageName: string | undefined): boolean {
  return packageName === "kimi-toolchain";
}
