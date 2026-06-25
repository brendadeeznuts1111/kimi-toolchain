import { describe, expect, test } from "bun:test";
import {
  buildPrioritizedIssues,
  buildProposedActions,
  computeConfidenceBreakdown,
  computeOverallConfidence,
} from "../src/lib/agent-diagnosis.ts";
import { generateAgentDiagnosisReport } from "../src/lib/agent-diagnosis.ts";
import type {
  ErrorCoverageAudit,
  FailureLedgerSummary,
  HealthCheck,
  TuningSetVersionReport,
} from "../src/lib/agent-types.ts";

function coverageFixture(coverage: number): ErrorCoverageAudit {
  const total = 10;
  const classified = Math.round(total * coverage);
  return {
    total,
    classified,
    coverage,
    unclassified: [],
    records: [],
  };
}

function ledgerFixture(unclassified = 0, total = 10): FailureLedgerSummary {
  return {
    path: "/tmp/tool-failures.jsonl",
    present: true,
    total,
    taxonomyCounts: { unknown: unclassified },
    unclassified,
    managedUnclassified: unclassified,
    agentUnclassified: 0,
    reviewCommand: "kimi-debug ledger /tmp/tool-failures.jsonl",
    unknownBuckets: [],
    managedUnknownBuckets: [],
  };
}

function tuningSetFixture(aligned = true, applicable = true): TuningSetVersionReport {
  return {
    applicable,
    aligned,
    currentVersion: applicable ? '"1.0.0"' : null,
    expectedVersion: applicable ? '"1.0.0"' : null,
    checks: applicable
      ? [{ name: "tuning-set-version", status: "ok" as const, message: '"1.0.0"', fixable: false }]
      : [],
  };
}

describe("agent-diagnosis", () => {
  describe("utils", () => {
    test("computeConfidenceBreakdown caps error coverage at target", () => {
      const breakdown = computeConfidenceBreakdown(
        coverageFixture(1),
        ledgerFixture(0),
        tuningSetFixture()
      );
      expect(breakdown.errorCoverage).toBe(1);
      expect(breakdown.ledgerClassification).toBe(1);
      expect(breakdown.tuningSetAlignment).toBe(1);
    });

    test("computeConfidenceBreakdown penalizes unclassified ledger entries", () => {
      const breakdown = computeConfidenceBreakdown(
        coverageFixture(0.9),
        ledgerFixture(5, 10),
        tuningSetFixture()
      );
      expect(breakdown.ledgerClassification).toBe(0.5);
    });

    test("computeOverallConfidence averages dimensions", () => {
      const breakdown = computeConfidenceBreakdown(
        coverageFixture(0.9),
        ledgerFixture(0),
        tuningSetFixture(false)
      );
      breakdown.healthCheckPassRate = 1;
      const overall = computeOverallConfidence(breakdown);
      expect(overall).toBeGreaterThan(0);
      expect(overall).toBeLessThanOrEqual(1);
    });

    test("buildPrioritizedIssues sorts errors above warnings", () => {
      const checks: HealthCheck[] = [
        { name: "ok-check", status: "ok", message: "fine", fixable: false },
        { name: "warn-check", status: "warn", message: "careful", fixable: false },
        { name: "error-check", status: "error", message: "broken", fixable: true, autoFix: "fix" },
      ];
      const issues = buildPrioritizedIssues(checks, ledgerFixture(0), tuningSetFixture());
      expect(issues[0]?.name).toBe("error-check");
      expect(issues[1]?.name).toBe("warn-check");
      expect(issues[2]?.name).toBe("ok-check");
    });

    test("buildPrioritizedIssues surfaces ledger unknowns", () => {
      const issues = buildPrioritizedIssues([], ledgerFixture(3, 10), tuningSetFixture());
      const ledgerIssue = issues.find((i) => i.name === "failure-ledger-unknowns");
      expect(ledgerIssue).toBeDefined();
      expect(ledgerIssue?.status).toBe("warn");
      expect(ledgerIssue?.autoFix).toContain("kimi-debug ledger");
    });

    test("buildProposedActions emits review-ledger for unknown buckets", () => {
      const issues = buildPrioritizedIssues([], ledgerFixture(2, 10), tuningSetFixture());
      const actions = buildProposedActions(issues, ledgerFixture(2, 10));
      expect(actions.some((a) => a.id === "review-ledger-unknowns")).toBe(true);
    });

    test("buildProposedActions emits coverage action for failing error-coverage", () => {
      const checks: HealthCheck[] = [
        {
          name: "error-coverage",
          status: "error",
          message: "50% classified",
          fixable: false,
          category: "blocking_issue",
        },
      ];
      const issues = buildPrioritizedIssues(checks, ledgerFixture(0), tuningSetFixture());
      const actions = buildProposedActions(issues, ledgerFixture(0));
      expect(actions.some((a) => a.id === "improve-error-coverage")).toBe(true);
    });
  });

  test(
    "generateAgentDiagnosisReport returns a valid report shape",
    async () => {
      const report = await generateAgentDiagnosisReport(process.cwd());

      expect(report.schemaVersion).toBe(1);
      expect(report.tool).toBe("kimi-doctor");
      expect(report.projectRoot).toBe(process.cwd());
      expect(typeof report.generatedAt).toBe("string");

      expect(report.summary).toHaveProperty("overallConfidence");
      expect(report.summary).toHaveProperty("issueCount");
      expect(report.summary).toHaveProperty("fixableIssueCount");

      expect(Array.isArray(report.prioritizedIssues)).toBe(true);
      expect(Array.isArray(report.proposedActions)).toBe(true);

      expect(report.sourceData).toHaveProperty("errorCoverage");
      expect(report.sourceData).toHaveProperty("ledger");
      expect(report.sourceData).toHaveProperty("tuningSet");

      expect(report.confidenceBreakdown).toHaveProperty("errorCoverage");
      expect(report.confidenceBreakdown).toHaveProperty("ledgerClassification");
      expect(report.confidenceBreakdown).toHaveProperty("healthCheckPassRate");
      expect(report.confidenceBreakdown).toHaveProperty("tuningSetAlignment");
    },
    { timeout: 10000 }
  );
});
