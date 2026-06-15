/**
 * Success metrics audit.
 *
 * These checks turn product-level goals into CI-visible contracts.
 */

import { existsSync } from "fs";
import { join } from "path";
import { checkDocDrift } from "./readme-sync.ts";
import {
  buildClassifiedFailure,
  classifyFailure,
  loadTaxonomy,
  type ClassifiedFailure,
  type Taxonomy,
} from "./error-taxonomy.ts";
import {
  defineProviderIntegration,
  isTwoArtifactProviderIntegration,
  type ProviderIntegration,
} from "./provider-contract.ts";
import type { HealthCheck } from "./health-check.ts";

export const SUCCESS_METRIC_TERMS = [
  "Drift latency",
  "Error coverage",
  "Integration agility",
] as const;

export const ERROR_COVERAGE_TARGET = 0.9;

export interface ManagedFailureFixture {
  source: "contract" | "hook" | "integration";
  toolName: string;
  output: string;
  inputs: Record<string, unknown>;
  environment: Record<string, string>;
}

export interface ErrorCoverageAudit {
  total: number;
  classified: number;
  coverage: number;
  unclassified: ManagedFailureFixture[];
  records: ClassifiedFailure[];
}

export interface SuccessMetricsAudit {
  checks: HealthCheck[];
  errorCoverage: ErrorCoverageAudit;
  providerIntegration: ProviderIntegration;
}

export const MANAGED_FAILURE_FIXTURES: ManagedFailureFixture[] = [
  {
    source: "contract",
    toolName: "kimi-guardian",
    output: "HASH MISMATCH for bun.lock",
    inputs: { command: "kimi-guardian check", contract: "lockfile-integrity" },
    environment: { packageManager: "bun" },
  },
  {
    source: "contract",
    toolName: "scripts/check",
    output: "error TS2322: Type 'string' is not assignable to type 'number'",
    inputs: { command: "bun run typecheck", contract: "typescript" },
    environment: { runtime: "bun" },
  },
  {
    source: "contract",
    toolName: "scripts/check",
    output: 'error: script "format:check" exited with code 1',
    inputs: { command: "bun run format:check", contract: "format" },
    environment: { formatter: "oxfmt" },
  },
  {
    source: "hook",
    toolName: "PostToolUseFailure",
    output: "old_string not found in src/bin/kimi-doctor.ts, the file contents may be out of date",
    inputs: { hook: "PostToolUseFailure", tool: "Edit" },
    environment: { lifecycle: "kimi-code" },
  },
  {
    source: "hook",
    toolName: "PostToolUseFailure",
    output: "Tool timed out after 30000ms; SIGTERM sent",
    inputs: { hook: "PostToolUseFailure", timeoutMs: 30000 },
    environment: { lifecycle: "kimi-code" },
  },
  {
    source: "integration",
    toolName: "kimi-cloudflare-access",
    output: "Failed to fetch URL. Status: 403",
    inputs: { command: "kimi-cloudflare-access apps", provider: "cloudflare" },
    environment: { api: "cloudflare-v4" },
  },
  {
    source: "integration",
    toolName: "unified-shell-bridge",
    output: "Command failed: command not found: wrangler",
    inputs: { command: "wrangler deploy", provider: "cloudflare" },
    environment: { shell: "unified-shell" },
  },
  {
    source: "integration",
    toolName: "unified-shell-bridge",
    output: "EADDRINUSE: port already in use",
    inputs: { command: "bun run dev", port: 8787 },
    environment: { shell: "unified-shell" },
  },
  {
    source: "integration",
    toolName: "kimi-doctor",
    output: "MCP config missing unified-shell registration",
    inputs: { command: "kimi-doctor --quick", integration: "mcp" },
    environment: { config: "~/.kimi-code/mcp.json" },
  },
  {
    source: "contract",
    toolName: "kimi-doctor",
    output: "blocking workspace issue found",
    inputs: { command: "kimi-doctor workspace verify", contract: "workspace" },
    environment: { cwd: "kimi-toolchain" },
  },
];

export function auditErrorCoverage(taxonomy: Taxonomy): ErrorCoverageAudit {
  const records = MANAGED_FAILURE_FIXTURES.map((fixture) => {
    const match = classifyFailure(fixture.output, taxonomy);
    return buildClassifiedFailure(fixture.toolName, fixture.output, match, {
      context: {
        stack: `${fixture.toolName}: managed ${fixture.source} failure`,
        inputs: fixture.inputs,
        environment: fixture.environment,
      },
    });
  });
  const unclassified = records
    .map((record, index) => ({ record, fixture: MANAGED_FAILURE_FIXTURES[index] }))
    .filter((entry) => entry.record.taxonomyId === "unknown")
    .map((entry) => entry.fixture);
  const classified = records.length - unclassified.length;
  return {
    total: records.length,
    classified,
    coverage: classified / records.length,
    unclassified,
    records,
  };
}

export function buildProviderAgilityFixture(): ProviderIntegration {
  return defineProviderIntegration(
    {
      provider: "cloudflare",
      service: "access",
      shape: {
        app: "Access application",
        policies: "ordered policy declarations",
      },
      permissions: ["Account > Access: Read", "Account > Access: Edit"],
      errorCategories: ["http_error", "permission_denied", "network_timeout"],
    },
    {
      provider: "cloudflare",
      secretScope: "cloudflare-access",
      async getToken(getSecret) {
        return { value: await getSecret("cloudflare-access") };
      },
    }
  );
}

async function successDocsPresent(projectRoot: string): Promise<boolean> {
  const requiredFiles = ["README.md", "CONTEXT.md", "AGENTS.md"];
  for (const file of requiredFiles) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) return false;
    const text = await Bun.file(path).text();
    for (const term of SUCCESS_METRIC_TERMS) {
      if (!text.includes(term)) return false;
    }
  }
  return true;
}

export async function auditSuccessMetrics(projectRoot: string): Promise<SuccessMetricsAudit> {
  const checks: HealthCheck[] = [];
  const docDrift = await checkDocDrift(projectRoot);
  const taxonomy = await loadTaxonomy(join(projectRoot, "error-taxonomy.yml"));
  const errorCoverage = auditErrorCoverage(taxonomy);
  const providerIntegration = buildProviderAgilityFixture();

  checks.push({
    name: "success-metrics-docs",
    status: (await successDocsPresent(projectRoot)) ? "ok" : "error",
    message:
      "README, CONTEXT, and AGENTS describe drift latency, error coverage, and integration agility",
    fixable: false,
    category: "blocking_issue",
  });

  checks.push({
    name: "drift-latency",
    status: docDrift?.fresh ? "ok" : "error",
    message: docDrift?.fresh
      ? "README command drift has a pass/fail result in one kimi-doctor run"
      : "README command drift is unresolved or package.json is invalid",
    fixable: true,
    autoFix: "bun run docs:sync",
    category: "blocking_issue",
  });

  checks.push({
    name: "error-coverage",
    status: errorCoverage.coverage >= ERROR_COVERAGE_TARGET ? "ok" : "error",
    message: `${Math.round(errorCoverage.coverage * 100)}% classified (${errorCoverage.classified}/${errorCoverage.total}); target ${Math.round(ERROR_COVERAGE_TARGET * 100)}%`,
    fixable: false,
    category: "blocking_issue",
  });

  checks.push({
    name: "integration-agility",
    status: isTwoArtifactProviderIntegration(providerIntegration) ? "ok" : "error",
    message:
      "Provider fixture is represented by exactly a contract declaration and credential adapter",
    fixable: false,
    category: "blocking_issue",
  });

  return { checks, errorCoverage, providerIntegration };
}
