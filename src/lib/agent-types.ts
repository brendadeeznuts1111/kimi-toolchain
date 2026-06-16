/**
 * Agent-facing diagnosis report types.
 *
 * These types define a stable, machine-readable output for `kimi-doctor --agent --json`
 * so that agents can reason about project health, prioritize issues, and pick next actions.
 */

import type { ErrorCoverageAudit, FailureLedgerSummary } from "./success-metrics.ts";
import type { HealthCheck } from "./health-check.ts";
import type { TuningSetVersionReport } from "./tuning-set-version.ts";

/** Per-dimension confidence scores (0-1). */
export interface ConfidenceBreakdown {
  /** Derived from the error-coverage metric. */
  errorCoverage: number;
  /** Derived from absence of unclassified live ledger failures. */
  ledgerClassification: number;
  /** Derived from health-check pass rate. */
  healthCheckPassRate: number;
  /** Derived from tuning-set alignment. */
  tuningSetAlignment: number;
}

/** A single issue surfaced to an agent, sorted by priority. */
export interface PrioritizedIssue {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  priority: number;
  category?: string;
  autoFix?: string;
}

/** A concrete, runnable action proposed to the agent. */
export interface ProposedAction {
  id: string;
  title: string;
  command?: string;
  rationale: string;
  expectedImpact: "high" | "medium" | "low";
}

/** Stable machine-readable report emitted by `kimi-doctor --agent --json`. */
export interface AgentDiagnosisReport {
  schemaVersion: 1;
  tool: "kimi-doctor";
  generatedAt: string;
  projectRoot: string;
  summary: {
    overallConfidence: number;
    issueCount: number;
    fixableIssueCount: number;
  };
  confidenceBreakdown: ConfidenceBreakdown;
  prioritizedIssues: PrioritizedIssue[];
  proposedActions: ProposedAction[];
  sourceData: {
    errorCoverage: ErrorCoverageAudit;
    ledger: FailureLedgerSummary;
    tuningSet: TuningSetVersionReport;
  };
}

/** Re-export input types so consumers can build mocks without extra imports. */
export type { ErrorCoverageAudit, FailureLedgerSummary, HealthCheck, TuningSetVersionReport };
