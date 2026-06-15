/**
 * Phase 3 skeleton — correlate bound-constant repairs with taxonomy/cluster outcomes.
 */

import { readDecisions, type Decision } from "./decision-ledger.ts";
import { readClusterMetadata, type ClusterMetadataFile } from "./failure-ledger.ts";
import { loadRepoDefineMap } from "./build-constants-registry.ts";
import { buildBoundConstantIndex } from "./taxonomy-constants.ts";
import { readFailureTraceRecords, type FailureTraceRecord } from "./trace-ledger.ts";
import { failureLedgerPath } from "./paths.ts";

export const OPTIMIZER_SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ConstantRepairEvent {
  decisionId: string;
  timestamp: string;
  restoredKeys: string[];
  goldenVersion?: string;
}

export interface TaxonomyOutcomeWindow {
  taxonomyId: string;
  beforeCount: number;
  afterCount: number;
  delta: number;
}

export type ConstantOptimizerRecommendation = "hold" | "review" | "promote" | "insufficient-data";

export interface ConstantOptimizerEntry {
  constantKey: string;
  currentValue: string | number | boolean | undefined;
  boundTaxonomies: string[];
  repair: ConstantRepairEvent;
  taxonomyOutcomes: TaxonomyOutcomeWindow[];
  clusterHitsAfter: number;
  recommendation: ConstantOptimizerRecommendation;
  confidence: number;
  rationale: string;
}

export interface ConstantOptimizerReport {
  schemaVersion: typeof OPTIMIZER_SCHEMA_VERSION;
  generatedAt: string;
  windowMs: number;
  entries: ConstantOptimizerEntry[];
}

function restoredKeysFromDecision(decision: Decision): string[] {
  const restored = decision.metadata?.restoredKeys;
  return Array.isArray(restored)
    ? restored.filter((key): key is string => typeof key === "string")
    : [];
}

export function collectConstantRepairEvents(decisions: Decision[]): ConstantRepairEvent[] {
  return decisions
    .filter(
      (decision) =>
        decision.action === "config-change" &&
        decision.metadata?.type === "constant-repair" &&
        restoredKeysFromDecision(decision).length > 0
    )
    .map((decision) => ({
      decisionId: decision.decisionId,
      timestamp: decision.timestamp,
      restoredKeys: restoredKeysFromDecision(decision),
      goldenVersion:
        typeof decision.metadata?.goldenVersion === "string"
          ? decision.metadata.goldenVersion
          : undefined,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function taxonomyIdForFailure(record: FailureTraceRecord): string {
  return record.taxonomyId || record.categoryId || "unknown";
}

function countTaxonomyFailures(
  failures: FailureTraceRecord[],
  taxonomyIds: Set<string>,
  startMs: number,
  endMs: number
): number {
  let count = 0;
  for (const failure of failures) {
    const taxonomyId = taxonomyIdForFailure(failure);
    if (!taxonomyIds.has(taxonomyId)) continue;
    const ts = failure.timestamp ? new Date(failure.timestamp).getTime() : 0;
    if (ts >= startMs && ts < endMs) count++;
  }
  return count;
}

function countClusterHitsAfter(
  clusters: ClusterMetadataFile | null,
  taxonomyIds: Set<string>,
  decisionMs: number,
  windowMs: number
): number {
  if (!clusters) return 0;
  return clusters.clusters.filter(
    (cluster) =>
      taxonomyIds.has(cluster.topTaxonomy) &&
      new Date(clusters.generatedAt).getTime() >= decisionMs &&
      new Date(clusters.generatedAt).getTime() < decisionMs + windowMs
  ).length;
}

function deriveRecommendation(
  outcomes: TaxonomyOutcomeWindow[],
  beforeTotal: number,
  afterTotal: number
): { recommendation: ConstantOptimizerRecommendation; confidence: number; rationale: string } {
  if (beforeTotal + afterTotal === 0) {
    return {
      recommendation: "insufficient-data",
      confidence: 0.2,
      rationale: "No bound-taxonomy failures in the observation window",
    };
  }

  const improved = outcomes.filter((item) => item.delta < 0);
  const worsened = outcomes.filter((item) => item.delta > 0);

  if (worsened.length > 0) {
    return {
      recommendation: "review",
      confidence: Math.min(0.95, 0.55 + worsened.length * 0.1),
      rationale: `Failures increased for ${worsened.map((item) => item.taxonomyId).join(", ")} after repair`,
    };
  }

  if (improved.length > 0 && afterTotal < beforeTotal) {
    return {
      recommendation: "promote",
      confidence: Math.min(0.95, 0.6 + improved.length * 0.1),
      rationale: `Failures decreased for ${improved.map((item) => item.taxonomyId).join(", ")} after repair`,
    };
  }

  return {
    recommendation: "hold",
    confidence: 0.5,
    rationale: "No clear improvement or regression in bound-taxonomy failure rates",
  };
}

export async function buildConstantOptimizerReport(
  projectRoot: string,
  options: {
    failurePath?: string;
    windowMs?: number;
    nowMs?: number;
  } = {}
): Promise<ConstantOptimizerReport> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const decisions = await readDecisions(projectRoot);
  const repairs = collectConstantRepairEvents(decisions);
  const boundIndex = await buildBoundConstantIndex(projectRoot);
  const failures = await readFailureTraceRecords(options.failurePath ?? failureLedgerPath());
  const clusters = await readClusterMetadata();
  const defineMap = await loadRepoDefineMap(projectRoot);

  const entries: ConstantOptimizerEntry[] = [];

  for (const repair of repairs) {
    const decisionMs = new Date(repair.timestamp).getTime();

    for (const key of repair.restoredKeys) {
      const taxonomyIds = boundIndex.get(key);
      if (!taxonomyIds || taxonomyIds.length === 0) continue;

      const taxonomySet = new Set(taxonomyIds);
      const taxonomyOutcomes: TaxonomyOutcomeWindow[] = taxonomyIds.map((taxonomyId) => {
        const beforeCount = countTaxonomyFailures(
          failures,
          new Set([taxonomyId]),
          decisionMs - windowMs,
          decisionMs
        );
        const afterCount = countTaxonomyFailures(
          failures,
          new Set([taxonomyId]),
          decisionMs,
          decisionMs + windowMs
        );
        return {
          taxonomyId,
          beforeCount,
          afterCount,
          delta: afterCount - beforeCount,
        };
      });

      const beforeTotal = taxonomyOutcomes.reduce((sum, item) => sum + item.beforeCount, 0);
      const afterTotal = taxonomyOutcomes.reduce((sum, item) => sum + item.afterCount, 0);
      const { recommendation, confidence, rationale } = deriveRecommendation(
        taxonomyOutcomes,
        beforeTotal,
        afterTotal
      );

      entries.push({
        constantKey: key,
        currentValue: defineMap.get(key)?.value,
        boundTaxonomies: taxonomyIds,
        repair,
        taxonomyOutcomes,
        clusterHitsAfter: countClusterHitsAfter(clusters, taxonomySet, decisionMs, windowMs),
        recommendation,
        confidence,
        rationale,
      });
    }
  }

  return {
    schemaVersion: OPTIMIZER_SCHEMA_VERSION,
    generatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    windowMs,
    entries,
  };
}

export function formatConstantOptimizerReport(report: ConstantOptimizerReport): string {
  if (report.entries.length === 0) {
    return "No bound-constant repair events to correlate (run kimi-heal repair-constants first).";
  }

  const lines: string[] = [
    `Constant optimizer (${report.entries.length} bound repair event${report.entries.length === 1 ? "" : "s"}, window ${Math.round(report.windowMs / 3_600_000)}h)`,
  ];

  for (const entry of report.entries) {
    lines.push(
      `  ${entry.constantKey} = ${entry.currentValue ?? "(undefined)"} via ${entry.repair.decisionId}`
    );
    lines.push(`    bound taxonomies: ${entry.boundTaxonomies.join(", ")}`);
    for (const outcome of entry.taxonomyOutcomes) {
      lines.push(
        `    ${outcome.taxonomyId}: before=${outcome.beforeCount} after=${outcome.afterCount} (delta ${outcome.delta >= 0 ? "+" : ""}${outcome.delta})`
      );
    }
    lines.push(
      `    recommendation: ${entry.recommendation} (confidence ${entry.confidence.toFixed(2)}) — ${entry.rationale}`
    );
  }

  return lines.join("\n");
}
