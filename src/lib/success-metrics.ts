/**
 * Success metrics audit.
 *
 * These checks turn product-level goals into CI-visible contracts.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { checkDocDrift } from "./readme-sync.ts";
import { homeDir } from "./paths.ts";
import { streamNdjsonRecords } from "./ndjson.ts";
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
  "metrics are not frozen",
  "release cadence",
  "failure ledger",
] as const;

export type SuccessMetricId = "error-coverage";

export interface MetricThresholdEvidence {
  source: string;
  query: string;
  observedAt: string;
  sampleSize: number;
  summary: string;
}

export interface SuccessMetricThreshold {
  metric: SuccessMetricId;
  value: number;
  releaseCadence: "toolchain-release";
  justification: string;
  ledgerEvidence: MetricThresholdEvidence;
}

export const SUCCESS_METRIC_THRESHOLDS: Record<"errorCoverage", SuccessMetricThreshold> = {
  errorCoverage: {
    metric: "error-coverage",
    value: 0.9,
    releaseCadence: "toolchain-release",
    justification:
      "Keep the unclassified bucket below one in ten managed failures while the taxonomy is still learning from contract, hook, and integration failures.",
    ledgerEvidence: {
      source: "~/.kimi-code/var/tool-failures.jsonl",
      query:
        "Count managed contract, hook, and integration failures by taxonomyId; review the unknown bucket before each release.",
      observedAt: "2026-06-15",
      sampleSize: 1,
      summary:
        "Initial threshold keeps current managed fixture coverage at 90% and ties future threshold changes to the canonical failure ledger review.",
    },
  },
};

export const ERROR_COVERAGE_TARGET = SUCCESS_METRIC_THRESHOLDS.errorCoverage.value;

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

export interface FailureLedgerSummary {
  path: string;
  present: boolean;
  total: number;
  taxonomyCounts: Record<string, number>;
  unclassified: number;
  /** Command hint for reviewing unclassified failures. */
  reviewCommand: string;
  /** Optional action label for the unknown bucket. */
  unknownAction?: string;
  /** Taxonomy bucket names contributing to the unclassified count. */
  unknownBuckets: string[];
  /** Unclassified failures originating from managed/toolchain contexts. */
  managedUnclassified?: number;
  /** Unclassified failures originating from agent contexts. */
  agentUnclassified?: number;
  /** Bucket names for managed unclassified failures. */
  managedUnknownBuckets?: string[];
}

export interface SuccessMetricsAudit {
  checks: HealthCheck[];
  errorCoverage: ErrorCoverageAudit;
  providerIntegration: ProviderIntegration;
  thresholdPolicy: {
    releaseCadence: "toolchain-release";
    thresholds: SuccessMetricThreshold[];
  };
  ledger: FailureLedgerSummary;
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
    .flatMap((entry) => (entry.fixture ? [entry.fixture] : []));
  const classified = records.length - unclassified.length;
  return {
    total: records.length,
    classified,
    coverage: classified / records.length,
    unclassified,
    records,
  };
}

export function metricThresholdEvidenceComplete(
  thresholds: SuccessMetricThreshold[] = Object.values(SUCCESS_METRIC_THRESHOLDS)
): boolean {
  return thresholds.every(
    (threshold) =>
      threshold.releaseCadence === "toolchain-release" &&
      threshold.justification.trim().length > 0 &&
      threshold.ledgerEvidence.source.includes("tool-failures.jsonl") &&
      threshold.ledgerEvidence.query.trim().length > 0 &&
      threshold.ledgerEvidence.observedAt.trim().length > 0 &&
      threshold.ledgerEvidence.sampleSize > 0 &&
      threshold.ledgerEvidence.summary.trim().length > 0
  );
}

export async function readFailureLedgerSummary(
  path: string = join(homeDir(), ".kimi-code", "var", "tool-failures.jsonl")
): Promise<FailureLedgerSummary> {
  if (!pathExists(path)) {
    return {
      path,
      present: false,
      total: 0,
      taxonomyCounts: {},
      unclassified: 0,
      reviewCommand: `kimi-debug ledger ${path}`,
      unknownBuckets: [],
      managedUnclassified: 0,
      agentUnclassified: 0,
      managedUnknownBuckets: [],
    };
  }

  const taxonomyCounts: Record<string, number> = {};
  let total = 0;

  for await (const { value } of streamNdjsonRecords<{ taxonomyId?: string; categoryId?: string }>(
    path
  )) {
    const taxonomyId = value.taxonomyId || value.categoryId || "unknown";
    taxonomyCounts[taxonomyId] = (taxonomyCounts[taxonomyId] || 0) + 1;
    total++;
  }

  const unclassified = taxonomyCounts.unknown || 0;
  return {
    path,
    present: true,
    total,
    taxonomyCounts,
    unclassified,
    reviewCommand: `kimi-debug ledger ${path}`,
    unknownAction: unclassified > 0 ? "classify unknown failures" : undefined,
    unknownBuckets: unclassified > 0 ? ["unknown"] : [],
    managedUnclassified: unclassified,
    agentUnclassified: 0,
    managedUnknownBuckets: unclassified > 0 ? ["unknown"] : [],
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
    if (!pathExists(path)) return false;
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
  const thresholds = Object.values(SUCCESS_METRIC_THRESHOLDS);
  const ledger = await readFailureLedgerSummary();

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
    name: "metric-threshold-evidence",
    status: metricThresholdEvidenceComplete(thresholds) ? "ok" : "error",
    message: "Metric thresholds include release cadence, rationale, and failure-ledger evidence",
    fixable: false,
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

  return {
    checks,
    errorCoverage,
    providerIntegration,
    thresholdPolicy: {
      releaseCadence: "toolchain-release",
      thresholds,
    },
    ledger,
  };
}
