#!/usr/bin/env bun
/**
 * Enforce test file naming, describe conventions, and Bun-native test practices.
 *
 * Naming rules:
 * - test files use {stem}.{unit|integration|smoke|db|router}.test.ts

 * - *.unit.test.ts stem maps to a source module (src/lib, src/lib/effect, src/bin, types)
 * - Top-level describe("…") uses kebab-case and starts with the file stem
 *   (grandfathered files listed in LEGACY_DESCRIBE_EXEMPT)
 *
 * Convention rules (exempt test/helpers.ts):
 * - No node:fs / fs sync imports
 * - No process.env — use Bun.env or withEnv()
 * - No console.log = / console.error = — use captureConsole helpers
 * - No duplicate REPO_ROOT — import from test/helpers.ts
 * - No mkdtempSync / readFileSync / writeFileSync
 */

import { parseArgs } from "util";
import { basename, join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { UNIT_TEST_FILES } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

/** Unit test stems that intentionally target a non-default source path. */
const UNIT_STEM_SOURCE: Record<string, string> = {
  lib: "src/lib/utils.ts",
  "build-constants": "types/build-constants.d.ts",
  "path-alignment": "src/lib/workspace-health.ts",
  "workspace-known-blockers": "src/lib/workspace-known-blockers.ts",
  sync: "src/lib/desktop-sync.ts",
  "sync-archive": "src/lib/desktop-sync.ts",
  "archive-baseline-integration": "src/lib/desktop-sync.ts",

  "telemetry-schema": "src/lib/error-taxonomy.ts",
  "unified-shell-bridge": "src/bin/unified-shell-bridge.ts",
  "kimi-githooks": "src/bin/kimi-githooks.ts",
  "kimi-governance": "src/bin/kimi-governance.ts",
  "identity-matrix": "src/lib/identity-matrix.ts",
  "identity-pairing": "src/lib/effect/identity-service.ts",
  "secrets-metadata": "src/lib/secrets-constants.ts",
  "secrets-audit": "src/lib/secrets-audit.ts",
  "secrets-policy": "src/lib/secrets-policy.ts",
  "identity-usage-example": "examples/identity-usage-example.ts",
  "kimi-identity": "src/bin/kimi-identity.ts",
  "kimi-mcp": "src/bin/kimi-mcp.ts",
  "kimi-docs-aligned": "src/lib/kimi-docs-aligned.ts",
  "cloudflare-access-dashboard": "src/lib/cloudflare-access.ts",
  "scaffold-agents": "src/lib/scaffold-agents.ts",
  "lint-test-names": "scripts/lint-test-names.ts",
  "lint-build-constants": "scripts/lint-build-constants.ts",
  "constants-registry": "src/lib/constants-registry.ts",
  "optimizer-doctor": "src/lib/constant-optimizer.ts",
  "decision-list-diff": "src/lib/decision-ledger.ts",
  "audit-effects": "src/bin/kimi-heal.ts",
  "html-reporter": "src/harness/html-reporter.ts",
  "guardian-verify": "src/guardian/verify.ts",
  "taxonomy-coverage": "src/lib/taxonomy-coverage.ts",
  "herdr-socket-saturation": "src/lib/herdr-socket-client.ts",
  "herdr-socket-saturation-subscribe": "src/lib/herdr-socket-client.ts",
  "doctor-secret-audit": "src/doctor/secret-audit.ts",
  "doctor-secret-isolation": "src/doctor/secret-isolation.ts",
  "hardcoded-secret-audit": "src/lib/hardcoded-secret-audit.ts",
  "doctor-network-audit": "src/lib/network-config.ts",
  "image-audit": "src/lib/image-audit.ts",
  "perf-gate": "src/guardian/perf-gate.ts",
  "perf-gate-format": "src/lib/perf-gate-format.ts",
  timing: "src/lib/timing.ts",
  "tls-compliance": "src/guardian/tls-compliance.ts",
  "artifact-store": "src/lib/artifact-store.ts",
  "portal-convergence": "src/lib/artifact-portal.ts",
  "artifact-portal": "src/lib/artifact-portal.ts",
  "benchmark-manifest": "src/canvases/benchmark.manifest.ts",
  "markdown-dead-links": "src/lib/markdown-dead-links-lint.ts",
  "bun-utils-base64": "src/lib/bun-utils.ts",
  "bun-utils-hostname": "src/lib/bun-utils.ts",
  "bun-utils-runtime": "src/lib/bun-utils.ts",
  "bun-utils-jsc": "src/lib/bun-utils.ts",
  "bun-utils-editor": "src/lib/bun-utils.ts",
  "bun-utils-streams": "src/lib/bun-utils.ts",
  "bun-utils-memory": "src/lib/bun-utils.ts",
  "memory-governor": "src/lib/memory/governor.ts",
  "autophagy-scan": "src/lib/autophagy-scan.ts",
  "bun-color-formats": "src/lib/bun-color-formats.ts",
  "verify-bun-features-runner": "src/lib/verify-bun-features-runner.ts",
  "template-policy-audit": "src/lib/template-policy-audit.ts",
  "audit-endpoints-metadata": "src/lib/audit-endpoints-metadata.ts",
  "ast-grep-gate": "src/lib/ast-grep-gate.ts",
  "bun-docs-mcp": "src/lib/bun-docs-mcp.ts",
  "bun-runtime-utils-coverage": "src/lib/bun-runtime-utils-coverage.ts",
  "bun-binary-portability": "src/lib/bun-binary-portability.ts",
  "bun-web-globals-contract": "src/lib/bun-web-globals-contract.ts",
  "bun-upstream-test-refs": "src/lib/bun-upstream-test-refs.ts",
  "bun-upstream-cli-alignment": "src/lib/bun-upstream-cli-alignment.ts",
  "bun-cli-console-depth": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-user-agent": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-bun": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-bunfig-test-options": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-heap-prof": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-bun-options": "src/lib/bun-cli-contract-probes.ts",
  "bun-cli-run-test": "src/lib/bun-cli-run-test-probes.ts",
  "bun-cli-bun-test": "src/lib/bun-cli-bun-test-probes.ts",
  "bun-cli-markdown": "src/lib/bun-cli-markdown-probes.ts",
  "bun-cli-test-changed": "src/lib/bun-cli-test-changed-probes.ts",
  "bun-cli-env": "src/lib/bun-cli-env-probes.ts",
  "bun-release-inspect": "src/lib/bun-release-inspect.ts",
  "head-table-typed": "scripts/head-table-typed.ts",
  "audit-release-blogs": "scripts/audit-release-blogs.ts",
  "validate-release-ssot": "scripts/validate-release-ssot.ts",
  "workspace-runtime": "src/lib/workspace-runtime.ts",
  "runtime-introspection": "src/lib/runtime-introspection.ts",
  "open-check-source": "src/lib/open-check-source.ts",
  "mcp-probe": "src/lib/mcp-probe.ts",
  "mcp-sse": "src/lib/mcp/sse.ts",
  "mcp-endpoints-metadata": "src/lib/mcp-endpoints-metadata.ts",
  "mcp-config": "src/lib/mcp-config.ts",
  "bun-release-compliance": "src/lib/cli-contract.ts",
  "bun-secrets-runtime": "src/lib/secrets-api.ts",
  compression: "src/lib/compression.ts",
  "bun-utils-password": "src/lib/bun-utils.ts",
  "bundle-gate": "src/lib/bundle-gate.ts",
  "bundle-gate-integration": "src/lib/bundle-gate.ts",
  "bun-mock-clock-patterns": "test/helpers/mock-clock.ts",
  "bun-set-system-time": "test/helpers/mock-clock.ts",
  "bun-tz-runtime": "src/lib/test-runtime.ts",
  "run-if-not-inflight": "src/lib/bun-utils.ts",
  "scan-tree-sync": "src/lib/globs.ts",
  "secrets-domain": "src/lib/secrets.ts",
  "token-auth": "src/lib/jwt.ts",
  workflow: "src/lib/workflow/loop.ts",

  "bunfig-policy-gate": "src/gates/bunfig-policy.ts",
  "gate-registry": "src/gates/registry.ts",
  "hardcoded-secrets-gate": "src/gates/hardcoded-secrets.ts",
  "runtime-utils-coverage-gate": "src/gates/runtime-utils-coverage.ts",
  "doctor-gates-runner": "src/gates/runner.ts",
  "kimi-doctor-gate": "src/bin/kimi-doctor.ts",
  "gates-trading": "src/gates/trading-metrics.ts",
  "dashboard-audit-store": "src/lib/dashboard-audit-store.ts",
  "herdr-dashboard-data": "src/lib/herdr-dashboard/data/data.ts",
  "herdr-dashboard-bridge": "src/lib/herdr-dashboard/server/bridge.ts",
  "herdr-dashboard-agents": "src/lib/herdr-dashboard/agents.ts",
  "herdr-dashboard-automation": "src/lib/herdr-dashboard/automation/automation.ts",
  "herdr-dashboard-cron": "src/lib/herdr-dashboard/cron.ts",
  "herdr-dashboard-discovery-cache": "src/lib/herdr-dashboard/discovery/cache.ts",
  "herdr-dashboard-discovery-meta": "src/lib/herdr-dashboard/discovery/meta.ts",
  "herdr-dashboard-effect-image": "src/lib/herdr-dashboard/effect-image.ts",
  "herdr-dashboard-events": "src/lib/herdr-dashboard/server/events.ts",
  "herdr-dashboard-gate-watch": "src/lib/herdr-dashboard/gates/gate-watch.ts",
  "herdr-dashboard-hub": "src/lib/herdr-dashboard/server/hub.ts",
  "herdr-dashboard-http3": "src/lib/herdr-dashboard/server/http3.ts",
  "herdr-dashboard-meta-gate": "src/lib/herdr-dashboard/gates/meta-gate.ts",
  "herdr-dashboard-server": "src/lib/herdr-dashboard/server/server.ts",
  "herdr-dashboard-session-selector": "src/lib/herdr-dashboard/session-selector.ts",
  "herdr-dashboard-sessions": "src/lib/herdr-dashboard/sessions.ts",
  "herdr-dashboard-watch": "src/lib/herdr-dashboard/watch.ts",
  "herdr-dashboard-webview-store": "src/lib/herdr-dashboard/webview/store.ts",
  "herdr-dashboard-widget-git": "src/lib/herdr-dashboard/widgets/git.ts",
  "herdr-dashboard-widget-logs": "src/lib/herdr-dashboard/widgets/logs.ts",
  "herdr-dashboard-widget-processes": "src/lib/herdr-dashboard/widgets/processes.ts",
  "herdr-dashboard-widget-processes-action": "src/lib/herdr-dashboard/widgets/processes-action.ts",
  "herdr-dashboard-widgets": "src/lib/herdr-dashboard/widgets/widgets.ts",
  "dx-config": "src/lib/effect/dx-config.ts",
  "bun-io-trading": "templates/modules/trading/src/trading/lib/bun-io.ts",
  "scaffold-trading": "src/lib/scaffold-modules.ts",
  "secrets-manager": "src/lib/secrets-manager.ts",
  "secrets-service": "src/lib/effect/secrets-service.ts",
  "introspection-docs": "src/lib/scaffold-agents.ts",
  "examples-dashboard-routes": "examples/dashboard/src/index.ts",
  "bun-docs": "examples/dashboard/src/handlers/bun-docs.ts",
  "dashboard-route-inventory": "src/lib/dashboard-route-inventory.ts",
  "dashboard-static-assets-lint": "src/lib/dashboard-static-assets-lint.ts",
  "feature-flags-constants": "src/lib/feature-flags-constants.ts",
  "error-format": "src/lib/error-format.ts",
  "dashboard-token-handlers": "examples/dashboard/src/handlers/token-jwt.ts",
  "serve-error": "src/lib/serve-error.ts",
  "serve-metrics": "src/lib/serve-metrics.ts",
  "serve-websocket": "src/lib/serve-websocket.ts",
  "serve-cookies": "src/lib/serve-cookies.ts",
  "serve-session": "src/lib/serve-session.ts",
  "identity-flow": "examples/dashboard/src/handlers/identity-flow.ts",
  "identity-service": "src/lib/effect/identity-service.ts",
  "dashboard-trace-ledger": "examples/dashboard/src/handlers/trace-ledger.ts",
  "doctor-trace": "src/lib/trace-ledger.ts",
  shadowrealm: "examples/dashboard/src/handlers/shadowrealm.ts",
  "dashboard-card-loader": "src/lib/dashboard-card-loader.ts",
  "dashboard-card-loaders": "src/lib/dashboard-card-loaders.ts",
  "dashboard-loader-lanes-lint": "src/lib/dashboard-loader-lanes-lint.ts",
  "examples-dashboard-artifacts": "examples/dashboard/src/handlers/artifacts.ts",
  "examples-dashboard-canvas-filter": "examples/dashboard/src/handlers/canvas-cards.ts",
  "bun-test-handler": "examples/dashboard/src/handlers/bun-test.ts",
  "ci-pipeline": "src/lib/effect/ci-pipeline.ts",
  "ci-impact": "src/lib/ci-impact.ts",

  "kimi-dashboard-daemon": "src/bin/kimi-dashboard.ts",
  "kimi-dashboard-mcp": "src/bin/kimi-dashboard-mcp.ts",
  "email-i18n-gate": "src/gates/email-i18n.ts",
  "email-i18n": "src/lib/email-i18n.ts",
  "url-i18n-gate": "src/gates/url-i18n.ts",
  "reclassify-failure-ledger": "scripts/reclassify-failure-ledger.ts",
  "gzip-performance": "src/lib/bun-utils.ts",
  "buffer-from-performance": "src/lib/bun-io.ts",
  "fetch-header-casing": "src/lib/http-client.ts",
  "arm64-jsc-performance": "src/lib/utils.ts",
  "bun-cli-tooling": "src/lib/bun-install-config.ts",
  "bun-terminal": "examples/dashboard/src/handlers/terminal.ts",
  "bun-runtime-dashboard": "examples/dashboard/src/handlers/bun-runtime.ts",
  "bun-pm-dashboard": "examples/dashboard/src/handlers/bun-pm.ts",
  "bun-webview-automation": "src/lib/webview-console.ts",
  "bun-crypto": "src/lib/bun-utils.ts",
  "bun-image": "src/lib/bun-image.ts",
  "bun-cron": "src/lib/bun-utils.ts",
  "bun-markdown": "src/lib/bun-utils.ts",
  "source-map-memory": "src/lib/bun-install-config.ts",
  "parallel-console-buffering": "src/lib/bun-install-config.ts",
  "parallel-console": "src/lib/bun-install-config.ts",
  "snapshot-counter": "src/lib/snapshot-core.ts",
  "bun-wrap-ansi": "src/lib/inspect.ts",
  "wrap-ansi": "src/lib/inspect.ts",
  version: "src/lib/version.ts",
  "bun-json5-jsonl": "src/lib/bun-utils.ts",
  "bun-transpiler": "src/lib/bun-utils.ts",
  "bun-build": "src/lib/bun-utils.ts",
  "bun-toml": "src/lib/bun-utils.ts",
  "bun-yaml-serve": "src/lib/bun-utils.ts",
  "bun-spawn-which-uuid": "src/lib/bun-utils.ts",
  "bun-sleep-deepequals": "src/lib/bun-utils.ts",
  "bun-pack-profiler": "src/lib/bun-install-config.ts",
  "bun-buffer-swap": "src/lib/bun-utils.ts",
  "bun-dns": "src/lib/bun-utils.ts",
  "bun-urlpattern": "src/lib/bun-utils.ts",
  "bun-fake-timers": "src/lib/bun-utils.ts",
  "bun-console-j": "src/lib/bun-utils.ts",
  "bun-http-agent-keepalive": "src/lib/bun-utils.ts",
  "bun-serve-protocol": "src/lib/bun-utils.ts",
  "bun-compile-autoload": "src/lib/bun-utils.ts",
  "bun-string-width": "src/lib/bun-utils.ts",
  "bun-shell": "src/lib/bun-utils.ts",
  "bun-ffi": "src/lib/bun-utils.ts",
  "bun-timer-idle-start": "src/lib/bun-install-config.ts",
  "bun-terminal-peek-shrink": "src/lib/bun-utils.ts",
  "bun-plugin-alloc": "src/lib/bun-utils.ts",
  "http-header-limit": "src/lib/bun-utils.ts",
  "websocket-url-credentials": "src/lib/bun-utils.ts",
  "js-builtins-performance": "src/lib/bun-utils.ts",
  "bun-s3": "src/lib/bun-utils.ts",
  "hook-error-ledger": "src/lib/hook-error-ledger.ts",
  "expect-type-of": "src/lib/bun-utils.ts",
  "artifact-graph-convergence": "examples/dashboard/src/handlers/artifact-graph-convergence.ts",
  "deep-audit-webview-report": "src/doctor/deep-audit/webview-report.ts",
};

/** When the top-level describe uses a shorter module alias than the file stem. */
const DESCRIBE_STEM_ALIAS: Record<string, string> = {
  "cloudflare-access-dashboard": "cloudflare-access",
  sync: "desktop-sync",
  "telemetry-schema": "telemetry",
  "introspection-docs": "introspection",
  "trace-ledger": "trace",

  "error-clustering": "error-embedding",
  "kimi-dashboard-daemon": "kimi-dashboard",
  "email-i18n-gate": "email-i18n",
  "email-i18n": "email-i18n",
  "url-i18n-gate": "url-i18n",
  "benchmark-manifest": "benchmark-manifest",
  "markdown-dead-links": "markdown-dead-links-lint",
  "bun-yaml-serve": "bun-yaml",
  "bun-json5-jsonl": "bun-json5",
  "bun-spawn-which-uuid": "bun-spawn",
  "bun-sleep-deepequals": "bun-sleep",
  "bun-terminal-peek-shrink": "bun-terminal",
  "bun-plugin-alloc": "bun-plugin",
  "bun-utils-base64": "base64",
  "bun-utils-runtime": "bun-utils-runtime",
  "bun-color-formats": "bun-color-formats",
  "verify-bun-features-runner": "verify-bun-features-runner",
  "template-policy-audit": "template-policy-audit",
  "audit-endpoints-metadata": "audit-endpoints-metadata",
  "bun-docs-mcp": "bun-docs-mcp",
  "bun-runtime-utils-coverage": "bun-runtime-utils-coverage",
  "bun-binary-portability": "bun-binary-portability",
  "bun-web-globals-contract": "bun-web-globals-contract",
  "bun-upstream-test-refs": "bun-upstream-test-refs",
  "bun-upstream-cli-alignment": "bun-upstream-cli-alignment",
  "bun-cli-console-depth": "bun-cli-console-depth",
  "bun-cli-user-agent": "bun-cli-user-agent",
  "bun-cli-bun": "bun-cli-bun",
  "bun-cli-bunfig-test-options": "bun-cli-bunfig-test-options",
  "bun-cli-heap-prof": "bun-cli-heap-prof",
  "bun-cli-bun-options": "bun-cli-bun-options",
  "bun-cli-run-test": "bun-cli-run-test",
  "workspace-runtime": "workspace-runtime",
  "runtime-introspection": "runtime-introspection",
  "open-check-source": "open-check-source",
  "mcp-probe": "mcp-probe",
  "mcp-sse": "mcp-sse",
  "mcp-endpoints-metadata": "mcp-endpoints-metadata",
  "mcp-config": "mcp-config",
  "bun-utils-password": "password",
  "ci-impact": "ci",
  "githook-templates": "githook",
  "kimi-introspection-services": "kimi",
};

/** Allowed top-level describe prefixes for aggregate test files. */
const DESCRIBE_PREFIX_ALLOW: Record<string, string[]> = {
  "test/lib.unit.test.ts": ["lib/"],
};

/** Files allowed to keep legacy camelCase top-level describe until migrated. */
const LEGACY_DESCRIBE_EXEMPT = new Set([
  "test/build-constants.unit.test.ts",
  "test/build-constants-registry.unit.test.ts",
  "test/scaffold-agents.unit.test.ts",
  "test/tuning-set-version.unit.test.ts",
  "test/governance-check.unit.test.ts",
  "test/constants-heal.unit.test.ts",
  "test/conventional-commits.unit.test.ts",
  "test/changelog.unit.test.ts",
  "test/cloudflare-access.unit.test.ts",
  "test/decision-ledger.unit.test.ts",
  "test/decision-scoring.integration.test.ts",
  "test/kimi-fix.integration.test.ts",
  "test/cleanup-legacy.integration.test.ts",
  "test/ci-pipeline.unit.test.ts",
  "test/error-clustering.integration.test.ts",
]);

const FILENAME_PATTERN =
  /^test\/(?:effect\/|smoke\/|guardian\/|harness\/)?[a-z0-9]+(?:-[a-z0-9]+)*\.(?:unit|integration|smoke|db|router)\.test\.ts$/;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function resolveUnitSource(root: string, rel: string, stem: string): string {
  if (UNIT_STEM_SOURCE[stem]) return UNIT_STEM_SOURCE[stem];
  const candidates = rel.startsWith("test/effect/")
    ? [`src/lib/effect/${stem}.ts`, `src/lib/${stem}.ts`]
    : [`src/lib/${stem}.ts`];
  for (const candidate of candidates) {
    if (pathExists(join(root, candidate))) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

function parseStem(rel: string): string | null {
  const name = basename(rel);
  const match = name.match(/^(.+)\.(unit|integration|smoke|db|router)\.test\.ts$/);
  return match?.[1] ?? null;
}

function firstTopLevelDescribe(text: string): string | null {
  const match = text.match(/describe\s*\(\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? null;
}

// ── Convention rules (ex-lint-test-conventions.ts) ───────────────────

const HELPERS = "test/helpers.ts";

interface ConventionViolation {
  file: string;
  line: number;
  ruleId: string;
  message: string;
  snippet: string;
}

const CONVENTION_RULES: Array<{
  id: string;
  pattern: RegExp;
  message: string;
  exempt?: RegExp;
}> = [
  {
    id: "node-fs-import",
    pattern: /from\s+["'](?:node:)?fs["']/,
    message: "Use Bun.file / bun-io.ts or test/helpers.ts instead of fs imports",
  },
  {
    id: "process-env",
    pattern: /\bprocess\.env\b/,
    message: "Use Bun.env or withEnv() from test/helpers.ts",
  },
  {
    id: "console-assign",
    pattern: /\bconsole\.(log|error|warn)\s*=/,
    message: "Use captureConsole / captureConsoleError / captureStdout from test/helpers.ts",
    exempt: /test\/helpers\.ts$/,
  },
  {
    id: "sync-fs-api",
    pattern: /\b(readFileSync|writeFileSync|mkdirSync|rmSync|mkdtempSync|existsSync)\s*\(/,
    message: "Use bun-io.ts helpers or test/helpers.ts",
  },
  {
    id: "spawn-rm-rf",
    pattern: /Bun\.spawnSync\(\s*\[\s*["']rm["']\s*,\s*["']-rf["']/,
    message: "Use cleanupPath() from test/helpers.ts",
  },
  {
    id: "local-repo-root",
    pattern: /const\s+REPO_ROOT\s*=\s*join\s*\(\s*import\.meta\.dir/,
    message: "Import { REPO_ROOT } from test/helpers.ts (or relative ./helpers.ts)",
    exempt: /test\/helpers\.ts$/,
  },
];

function stripStringLiterals(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function scanConventions(rel: string, text: string): ConventionViolation[] {
  if (rel === HELPERS) return [];
  const lines = text.split("\n");
  const violations: ConventionViolation[] = [];
  for (const rule of CONVENTION_RULES) {
    if (rule.exempt?.test(rel)) continue;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      if (raw.trimStart().startsWith("//")) continue;
      const line = stripStringLiterals(raw);
      if (!rule.pattern.test(line)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        ruleId: rule.id,
        message: rule.message,
        snippet: raw.trim().slice(0, 120),
      });
    }
  }
  return violations;
}

export async function lintTestConventions(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<string[]> {
  const violations: string[] = [];
  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("test/") || !rel.endsWith(".ts")) continue;
      if (rel === HELPERS) continue;
      let text: string;
      try {
        text = await Bun.file(join(root, rel)).text();
      } catch {
        continue;
      }
      for (const v of scanConventions(rel, text)) {
        violations.push(`${v.file}:${v.line} [${v.ruleId}] ${v.message}\n    ${v.snippet}`);
      }
    }
    return violations;
  }
  const convGlob = new Bun.Glob("test/**/*.ts");
  for await (const rel of convGlob.scan({ cwd: root, onlyFiles: true })) {
    const text = await Bun.file(join(root, rel)).text();
    for (const v of scanConventions(rel, text)) {
      violations.push(`${v.file}:${v.line} [${v.ruleId}] ${v.message}\n    ${v.snippet}`);
    }
  }
  return violations;
}

// ── Test naming rules ────────────────────────────────────────────────

export async function lintTestNames(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<string[]> {
  const violations: string[] = [];
  const glob = new Bun.Glob("test/**/*.test.ts");

  const scanRel = async (rel: string): Promise<void> => {
    if (!FILENAME_PATTERN.test(rel)) {
      violations.push(
        `${rel}: filename must match {stem}.{unit|integration|smoke|db|router}.test.ts`
      );
      return;
    }

    const stem = parseStem(rel);
    if (stem && rel.endsWith(".unit.test.ts")) {
      const source = resolveUnitSource(root, rel, stem);
      if (!pathExists(join(root, source))) {
        violations.push(`${rel}: unit stem "${stem}" has no source at ${source}`);
      }
    }

    const text = await Bun.file(join(root, rel)).text();
    const describeLabel = firstTopLevelDescribe(text);
    if (!describeLabel || LEGACY_DESCRIBE_EXEMPT.has(rel)) return;

    const stemForDescribe = stem ?? basename(rel, ".test.ts");
    const allowedPrefixes = DESCRIBE_PREFIX_ALLOW[rel];
    if (allowedPrefixes?.some((entry) => describeLabel.startsWith(entry))) return;

    const prefix = describeLabel.split(/\s/)[0]!;
    if (!KEBAB.test(prefix)) {
      violations.push(
        `${rel}: top-level describe "${describeLabel}" must use kebab-case (grep-friendly)`
      );
      return;
    }

    const expectedStem = DESCRIBE_STEM_ALIAS[stemForDescribe] ?? stemForDescribe;
    if (prefix !== expectedStem && !describeLabel.startsWith(`${expectedStem} `)) {
      violations.push(
        `${rel}: top-level describe must start with file stem "${expectedStem}" (got "${prefix}")`
      );
    }
  };

  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("test/") || !rel.endsWith(".test.ts")) continue;
      await scanRel(rel);
    }
  } else {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      await scanRel(rel);
    }

    for (const rel of UNIT_TEST_FILES) {
      if (!pathExists(join(root, rel))) {
        violations.push(`test-gates: UNIT_TEST_FILES entry missing on disk: ${rel}`);
      }
    }
  }

  return violations;
}

function normalizeTargetDir(dir: string): string {
  return dir.replace(/\/+$/, "") || ".";
}

/** Collect test/*.ts paths under subdirectories and/or explicit file paths. */
export function collectLintTargetFiles(targets?: string[]): {
  targetDir: string | null;
  conventionFiles: string[];
  nameFiles: string[];
} {
  if (targets === undefined || targets.length === 0) {
    return { targetDir: null, conventionFiles: [], nameFiles: [] };
  }

  if (targets.every((target) => target.endsWith(".ts"))) {
    const conventionFiles = [...new Set(targets)];
    return {
      targetDir: conventionFiles.join(", "),
      conventionFiles,
      nameFiles: conventionFiles.filter((rel) => rel.endsWith(".test.ts")),
    };
  }

  const conventionFiles = [
    ...new Set(
      targets.flatMap((target) => [
        ...new Bun.Glob(`${normalizeTargetDir(target)}/**/*.ts`).scanSync({
          cwd: REPO_ROOT,
          onlyFiles: true,
        }),
      ])
    ),
  ];
  const nameFiles = conventionFiles.filter((rel) => rel.endsWith(".test.ts"));
  return { targetDir: targets.map(normalizeTargetDir).join(", "), conventionFiles, nameFiles };
}

export function parseLintTestNamesCli(argv: string[]): {
  json: boolean;
  namesOnly: boolean;
  targets: string[];
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      "names-only": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  return {
    json: values.json ?? false,
    namesOnly: values["names-only"] ?? false,
    targets: positionals,
  };
}

async function main(): Promise<void> {
  const { json, namesOnly, targets } = parseLintTestNamesCli(Bun.argv.slice(2));
  const scoped = collectLintTargetFiles(targets.length > 0 ? targets : undefined);
  const onlyConvention =
    scoped.targetDir !== null ? scoped.conventionFiles : namesOnly ? [] : undefined;
  const onlyNames = scoped.targetDir !== null ? scoped.nameFiles : undefined;

  const [nameViolations, conventionViolations] = await Promise.all([
    lintTestNames(REPO_ROOT, onlyNames),
    namesOnly && scoped.targetDir === null
      ? Promise.resolve([])
      : lintTestConventions(REPO_ROOT, onlyConvention),
  ]);

  const ok = nameViolations.length === 0 && conventionViolations.length === 0;

  if (json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          tool: "lint-test-names",
          ok,
          targetDir: scoped.targetDir,
          filesScanned: scoped.targetDir !== null ? scoped.conventionFiles.length : null,
          naming: { ok: nameViolations.length === 0, violations: nameViolations },
          conventions: { ok: conventionViolations.length === 0, violations: conventionViolations },
        },
        null,
        2
      )
    );
    process.exit(ok ? 0 : 1);
    return;
  }

  let exit = 0;

  if (scoped.targetDir !== null) {
    const scopeLabel = targets.every((t) => t.endsWith(".ts"))
      ? scoped.targetDir
      : `${scoped.targetDir}/`;
    console.log(`lint scope: ${scopeLabel} (${scoped.conventionFiles.length} file(s))`);
  }

  if (nameViolations.length > 0) {
    console.error("✗ Test naming violations:\n");
    for (const line of nameViolations) console.error(`  ${line}`);
    exit = 1;
  } else {
    console.log("lint:test-names OK");
  }

  if (namesOnly && scoped.targetDir === null) {
    console.log("test conventions: skipped (--names-only)");
  } else if (conventionViolations.length > 0) {
    console.error(`\ntest conventions: ${conventionViolations.length} violation(s)\n`);
    for (const line of conventionViolations) console.error(`  ${line}`);
    exit = 1;
  } else {
    console.log("test conventions: ok");
  }

  process.exit(exit);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("lint-test-names failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
