/**
 * Success metrics audit.
 *
 * These checks turn product-level goals into CI-visible contracts.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { checkDocDrift } from "./readme-sync.ts";
import { isManagedLedgerFailure } from "./hook-failure-text.ts";
import { failureLedgerPath } from "./paths.ts";
import { sha256String } from "./utils.ts";
import {
  buildClassifiedFailure,
  classifyFailure,
  loadTaxonomy,
  type ClassifiedFailure,
  type Taxonomy,
} from "./error-taxonomy.ts";
import {
  createCredentialAdapter,
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
  /** All unknown taxonomyId rows (includes agent runtime noise). */
  unclassified: number;
  /** Unknown rows from kimi-toolchain managed tools only. */
  managedUnclassified: number;
  /** Unknown rows from agent runtime tools (Bash, Read, …). */
  agentUnclassified: number;
  reviewCommand: string;
  unknownAction?: string;
  unknownBuckets: FailureLedgerUnknownBucket[];
  managedUnknownBuckets: FailureLedgerUnknownBucket[];
}

export interface FailureLedgerUnknownBucket {
  fingerprint: string;
  count: number;
  toolNames: string[];
  firstSeen?: string;
  lastSeen?: string;
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
  path: string = failureLedgerPath()
): Promise<FailureLedgerSummary> {
  const reviewCommand = `kimi-debug ledger ${path}`;
  if (!pathExists(path)) {
    return {
      path,
      present: false,
      total: 0,
      taxonomyCounts: {},
      unclassified: 0,
      managedUnclassified: 0,
      agentUnclassified: 0,
      reviewCommand,
      unknownBuckets: [],
      managedUnknownBuckets: [],
    };
  }

  const text = await Bun.file(path).text();
  const taxonomyCounts: Record<string, number> = {};
  const unknownBuckets = new Map<
    string,
    {
      count: number;
      toolNames: Set<string>;
      firstSeen?: string;
      lastSeen?: string;
    }
  >();
  const managedUnknownBuckets = new Map<
    string,
    {
      count: number;
      toolNames: Set<string>;
      firstSeen?: string;
      lastSeen?: string;
    }
  >();
  let total = 0;
  let managedUnclassified = 0;
  let agentUnclassified = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        taxonomyId?: string;
        categoryId?: string;
        toolName?: string;
        output?: string;
        timestamp?: string;
      };
      const taxonomyId = parsed.taxonomyId || parsed.categoryId || "unknown";
      taxonomyCounts[taxonomyId] = (taxonomyCounts[taxonomyId] || 0) + 1;
      if (taxonomyId === "unknown") {
        const bucketItem = {
          fingerprint: fingerprintUnknownFailure(parsed.output || trimmed),
          toolName: parsed.toolName,
          timestamp: parsed.timestamp,
        };
        recordUnknownBucket(unknownBuckets, bucketItem);
        if (isManagedLedgerFailure(parsed)) {
          managedUnclassified++;
          recordUnknownBucket(managedUnknownBuckets, bucketItem);
        } else {
          agentUnclassified++;
        }
      }
      total++;
    } catch {
      taxonomyCounts.unknown = (taxonomyCounts.unknown || 0) + 1;
      managedUnclassified++;
      recordUnknownBucket(unknownBuckets, {
        fingerprint: "malformed-json",
        toolName: "ledger-parser",
      });
      recordUnknownBucket(managedUnknownBuckets, {
        fingerprint: "malformed-json",
        toolName: "ledger-parser",
      });
      total++;
    }
  }

  const unclassified = taxonomyCounts.unknown || 0;
  return {
    path,
    present: true,
    total,
    taxonomyCounts,
    unclassified,
    managedUnclassified,
    agentUnclassified,
    reviewCommand,
    unknownBuckets: formatUnknownBuckets(unknownBuckets),
    managedUnknownBuckets: formatUnknownBuckets(managedUnknownBuckets),
    ...(managedUnclassified > 0
      ? {
          unknownAction:
            "Run the review command, then add or tune error-taxonomy.yml patterns for recurring managed failures.",
        }
      : {}),
  };
}

function fingerprintUnknownFailure(output: string): string {
  const normalized = output.replace(/\s+/g, " ").trim().slice(0, 1_000);
  return `sha256:${sha256String(normalized || "unknown-output").slice(0, 16)}`;
}

function recordUnknownBucket(
  buckets: Map<
    string,
    {
      count: number;
      toolNames: Set<string>;
      firstSeen?: string;
      lastSeen?: string;
    }
  >,
  item: { fingerprint: string; toolName?: string; timestamp?: string }
): void {
  const existing =
    buckets.get(item.fingerprint) ??
    buckets
      .set(item.fingerprint, {
        count: 0,
        toolNames: new Set<string>(),
      })
      .get(item.fingerprint)!;
  existing.count++;
  existing.toolNames.add(item.toolName || "unknown");
  if (item.timestamp) {
    if (!existing.firstSeen || item.timestamp < existing.firstSeen)
      existing.firstSeen = item.timestamp;
    if (!existing.lastSeen || item.timestamp > existing.lastSeen)
      existing.lastSeen = item.timestamp;
  }
}

function formatUnknownBuckets(
  buckets: Map<
    string,
    {
      count: number;
      toolNames: Set<string>;
      firstSeen?: string;
      lastSeen?: string;
    }
  >
): FailureLedgerUnknownBucket[] {
  return [...buckets.entries()]
    .map(([fingerprint, bucket]) => ({
      fingerprint,
      count: bucket.count,
      toolNames: [...bucket.toolNames].sort(),
      ...(bucket.firstSeen ? { firstSeen: bucket.firstSeen } : {}),
      ...(bucket.lastSeen ? { lastSeen: bucket.lastSeen } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
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
    createCredentialAdapter("cloudflare", "cloudflare-access")
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
    name: "failure-ledger-unknowns",
    status: ledger.managedUnclassified > 0 ? "warn" : "ok",
    message:
      ledger.managedUnclassified > 0
        ? `${ledger.managedUnclassified} unclassified managed ledger failure(s); review with ${ledger.reviewCommand}`
        : ledger.agentUnclassified > 0
          ? `${ledger.agentUnclassified} agent-runtime unknown(s) excluded from managed metric`
          : "failure ledger has no unclassified managed failures",
    fixable: ledger.managedUnclassified > 0,
    autoFix: ledger.managedUnclassified > 0 ? ledger.reviewCommand : undefined,
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
