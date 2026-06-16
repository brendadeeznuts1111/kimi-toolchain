/**
 * Generate a structured `AgentDiagnosisReport` for agent/programmatic consumption.
 */

import { auditSuccessMetrics } from "./success-metrics.ts";
import { checkTuningSetFreshness } from "./tuning-set-version.ts";
import type { AgentDiagnosisReport } from "./agent-types.ts";
import {
  buildPrioritizedIssues,
  buildProposedActions,
  computeConfidenceBreakdown,
  computeOverallConfidence,
} from "./agent-utils.ts";

export async function generateAgentDiagnosisReport(
  projectRoot: string
): Promise<AgentDiagnosisReport> {
  const metrics = await auditSuccessMetrics(projectRoot);
  const tuningSet = await checkTuningSetFreshness(projectRoot);

  const issues = buildPrioritizedIssues(metrics.checks, metrics.ledger, tuningSet);
  const healthChecks = issues.filter((i) => !i.name.startsWith("tuning-set:"));
  const healthPassRate =
    healthChecks.length > 0
      ? healthChecks.filter((i) => i.status === "ok").length / healthChecks.length
      : 1;

  const confidence = computeConfidenceBreakdown(metrics.errorCoverage, metrics.ledger, tuningSet);
  confidence.healthCheckPassRate = healthPassRate;

  const actions = buildProposedActions(issues, metrics.ledger);

  return {
    schemaVersion: 1,
    tool: "kimi-doctor",
    generatedAt: new Date().toISOString(),
    projectRoot,
    summary: {
      overallConfidence: computeOverallConfidence(confidence),
      issueCount: issues.filter((i) => i.status !== "ok").length,
      fixableIssueCount: issues.filter((i) => i.status !== "ok" && i.autoFix).length,
    },
    confidenceBreakdown: confidence,
    prioritizedIssues: issues,
    proposedActions: actions,
    sourceData: {
      errorCoverage: metrics.errorCoverage,
      ledger: metrics.ledger,
      tuningSet,
    },
  };
}
