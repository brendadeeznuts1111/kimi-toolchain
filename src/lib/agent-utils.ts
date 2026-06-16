/**
 * Pure helpers for building an `AgentDiagnosisReport`.
 *
 * All functions are side-effect free and take already-loaded audit data.
 */

import { ERROR_COVERAGE_TARGET } from "./success-metrics.ts";
import type {
  ConfidenceBreakdown,
  ErrorCoverageAudit,
  FailureLedgerSummary,
  HealthCheck,
  PrioritizedIssue,
  ProposedAction,
  TuningSetVersionReport,
} from "./agent-types.ts";

const STATUS_WEIGHT: Record<PrioritizedIssue["status"], number> = {
  error: 3,
  warn: 2,
  ok: 0,
};

export function computeConfidenceBreakdown(
  errorCoverage: ErrorCoverageAudit,
  ledger: FailureLedgerSummary,
  tuningSet: TuningSetVersionReport
): ConfidenceBreakdown {
  return {
    errorCoverage: Math.min(1, errorCoverage.coverage / ERROR_COVERAGE_TARGET),
    ledgerClassification: ledger.total > 0 ? 1 - ledger.unclassified / ledger.total : 1,
    healthCheckPassRate: 1, // populated from issues in generateAgentDiagnosisReport
    tuningSetAlignment: tuningSet.applicable ? (tuningSet.aligned ? 1 : 0.5) : 1,
  };
}

export function computeOverallConfidence(breakdown: ConfidenceBreakdown): number {
  const values = [
    breakdown.errorCoverage,
    breakdown.ledgerClassification,
    breakdown.healthCheckPassRate,
    breakdown.tuningSetAlignment,
  ];
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function buildPrioritizedIssues(
  checks: HealthCheck[],
  ledger: FailureLedgerSummary,
  tuningSet: TuningSetVersionReport
): PrioritizedIssue[] {
  const issues: PrioritizedIssue[] = checks.map((check) => ({
    name: check.name,
    status: check.status,
    message: check.message,
    priority: STATUS_WEIGHT[check.status] * 10,
    category: check.category,
    autoFix: check.autoFix,
  }));

  if (ledger.unclassified > 0) {
    issues.push({
      name: "failure-ledger-unknowns",
      status: "warn",
      message: `${ledger.unclassified} unclassified live ledger failure(s); review with ${ledger.reviewCommand}`,
      priority: STATUS_WEIGHT.warn * 10 + 1,
      category: "blocking_issue",
      autoFix: ledger.reviewCommand,
    });
  }

  for (const check of tuningSet.checks) {
    if (check.status === "ok") continue;
    issues.push({
      name: `tuning-set:${check.name}`,
      status: check.status,
      message: check.message,
      priority: STATUS_WEIGHT[check.status] * 10,
      autoFix: check.fixable ? "bun run manifest:generate" : undefined,
    });
  }

  return issues.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function buildProposedActions(
  issues: PrioritizedIssue[],
  ledger: FailureLedgerSummary
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  if (ledger.unclassified > 0) {
    actions.push({
      id: "review-ledger-unknowns",
      title: "Review unclassified failure-ledger entries",
      command: ledger.reviewCommand,
      rationale: "Unknown ledger entries hurt error-coverage and hide recurring failures.",
      expectedImpact: "high",
    });
  }

  const coverageIssue = issues.find((i) => i.name === "error-coverage" && i.status !== "ok");
  if (coverageIssue) {
    actions.push({
      id: "improve-error-coverage",
      title: "Add or tune error-taxonomy.yml patterns",
      command: "bun run lint:taxonomy-coverage",
      rationale: coverageIssue.message,
      expectedImpact: "high",
    });
  }

  const tuningIssue = issues.find((i) => i.name.startsWith("tuning-set:") && i.status !== "ok");
  if (tuningIssue) {
    actions.push({
      id: "align-tuning-set",
      title: "Align bunfig tuning-set version with manifest",
      command: "bun run manifest:generate",
      rationale: tuningIssue.message,
      expectedImpact: "medium",
    });
  }

  const driftIssue = issues.find((i) => i.name === "drift-latency" && i.status !== "ok");
  if (driftIssue?.autoFix) {
    actions.push({
      id: "sync-readme-scripts",
      title: "Sync README command documentation",
      command: driftIssue.autoFix,
      rationale: driftIssue.message,
      expectedImpact: "low",
    });
  }

  return actions;
}
