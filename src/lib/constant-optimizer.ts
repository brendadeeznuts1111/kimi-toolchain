/**
 * Phase 3 skeleton — correlate bound-constant repairs with taxonomy/cluster outcomes.
 */

import { Effect } from "effect";
import { logDecisionEffect, readDecisions, type Decision } from "./decision-ledger.ts";
import { readClusterMetadata, type ClusterMetadataFile } from "./failure-ledger.ts";
import { loadRepoDefineMap } from "./build-constants-registry.ts";
import { buildBoundConstantIndex, formatAgeShort } from "./taxonomy-constants.ts";
import type { Logger } from "./logger.ts";
import { readFailureTraceRecords, type FailureTraceRecord } from "./trace-ledger.ts";
import { failureLedgerPath } from "./paths.ts";
import { loadConstantsGolden } from "./constants-heal.ts";

export const OPTIMIZER_SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MS_DAY = 24 * 60 * 60 * 1000;

export type OptimizerDoctorSeverity = "info" | "warn" | "error";

export interface OptimizerDoctorRecommendation {
  constant: string;
  currentValue: unknown;
  goldenValue: unknown | undefined;
  candidateValue?: unknown;
  candidateId?: string;
  boundTaxonomies: string[];
  driftPct: number | null;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  baseConfidence?: number;
  basedOnDecisionIds: string[];
  outcomeCount: number;
  activeFailureCount: number;
  resolvedFailureCount: number;
  lastReviewMs: number;
  clusterFailureRateDelta: number | null;
  optimizerAction: ConstantOptimizerRecommendation;
  severity: OptimizerDoctorSeverity;
  action: string;
  message: string;
}

export interface OptimizerDoctorJsonRecommendation {
  constant: string;
  currentValue: unknown;
  recommendedValue: unknown;
  goldenValue?: unknown;
  candidateValue?: unknown;
  boundTaxonomies: string[];
  resolvedFailureCount: number;
  activeFailureCount: number;
  reason: string;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  reviewCommand: string;
  decisionIds: string[];
  severity: OptimizerDoctorSeverity;
}

export interface OptimizerApplyPlanItem {
  constant: string;
  currentValue: unknown;
  proposedValue: unknown;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  reason: string;
  decisionIds: string[];
}

export interface OptimizerApplySkippedItem extends OptimizerApplyPlanItem {
  skipReason: string;
}

export interface OptimizerApplyPlan {
  schemaVersion: typeof OPTIMIZER_SCHEMA_VERSION;
  minConfidence: number;
  requestedConstants: string[];
  selected: OptimizerApplyPlanItem[];
  skipped: OptimizerApplySkippedItem[];
}

export interface OptimizerApplyResult extends OptimizerApplyPlan {
  applied: boolean;
  dryRun: boolean;
  bunfigPath: string;
  decisionIds: string[];
  rewrittenBunfig?: string;
  detail: string;
}

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
  confidenceBreakdown: ConfidenceBreakdown;
  baseConfidence: number;
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

export function collectCandidateProposals(decisions: Decision[]): Map<string, unknown> {
  const proposals = new Map<string, unknown>();
  for (const decision of decisions) {
    if (decision.metadata?.type !== "constant-optimization") continue;
    const constantKey = decision.metadata?.constantKey;
    if (typeof constantKey !== "string") continue;
    if (decision.metadata?.candidateValue === undefined) continue;
    proposals.set(constantKey, decision.metadata.candidateValue);
  }
  return proposals;
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
  if (!clusters?.clusters?.length) return 0;
  return clusters.clusters.filter(
    (cluster) =>
      cluster.topTaxonomy &&
      taxonomyIds.has(cluster.topTaxonomy) &&
      new Date(clusters.generatedAt).getTime() >= decisionMs &&
      new Date(clusters.generatedAt).getTime() < decisionMs + windowMs
  ).length;
}

export const CONFIDENCE_FLOOR = 0.05;
export const INSUFFICIENT_DATA_BASE_CONFIDENCE = 0.2;
export const INSUFFICIENT_DATA_FLOOR_CONFIDENCE = 0.1;
const CONFIDENCE_HALF_LIFE_DAYS = 14;

export interface BaseRecommendation {
  recommendation: ConstantOptimizerRecommendation;
  confidence: number;
  rationale: string;
  confidenceBreakdown: ConfidenceBreakdown;
}

export interface ConfidenceDecayInput {
  recommendation: ConstantOptimizerRecommendation;
  baseConfidence: number;
  repairAgeMs: number;
  afterTotal: number;
}

export interface ConfidenceBreakdown {
  recommendation: ConstantOptimizerRecommendation;
  baseConfidence: number;
  finalConfidence: number;
  repairAgeDays: number;
  afterFailureCount: number;
  decayApplied: boolean;
  floorApplied: boolean;
  reason: string;
}

function optimizerDecayDays(): number {
  return typeof KIMI_OPTIMIZER_CONFIDENCE_DECAY_DAYS === "number"
    ? KIMI_OPTIMIZER_CONFIDENCE_DECAY_DAYS
    : 30;
}

export function computeBaseRecommendation(
  outcomes: TaxonomyOutcomeWindow[],
  beforeTotal: number,
  afterTotal: number
): BaseRecommendation {
  if (beforeTotal + afterTotal === 0) {
    const confidence = INSUFFICIENT_DATA_BASE_CONFIDENCE;
    return {
      recommendation: "insufficient-data",
      confidence,
      rationale: "No bound-taxonomy failures in the observation window",
      confidenceBreakdown: {
        recommendation: "insufficient-data",
        baseConfidence: confidence,
        finalConfidence: confidence,
        repairAgeDays: 0,
        afterFailureCount: afterTotal,
        decayApplied: false,
        floorApplied: false,
        reason: "No bound-taxonomy failures in the observation window",
      },
    };
  }

  const improved = outcomes.filter((item) => item.delta < 0);
  const worsened = outcomes.filter((item) => item.delta > 0);

  if (worsened.length > 0) {
    const confidence = Math.min(0.95, 0.55 + worsened.length * 0.1);
    return {
      recommendation: "review",
      confidence,
      rationale: `Failures increased for ${worsened.map((item) => item.taxonomyId).join(", ")} after repair`,
      confidenceBreakdown: {
        recommendation: "review",
        baseConfidence: confidence,
        finalConfidence: confidence,
        repairAgeDays: 0,
        afterFailureCount: afterTotal,
        decayApplied: false,
        floorApplied: false,
        reason: `${worsened.length} bound taxonomy failure rate(s) worsened`,
      },
    };
  }

  if (improved.length > 0 && afterTotal < beforeTotal) {
    const confidence = Math.min(0.95, 0.6 + improved.length * 0.1);
    return {
      recommendation: "promote",
      confidence,
      rationale: `Failures decreased for ${improved.map((item) => item.taxonomyId).join(", ")} after repair`,
      confidenceBreakdown: {
        recommendation: "promote",
        baseConfidence: confidence,
        finalConfidence: confidence,
        repairAgeDays: 0,
        afterFailureCount: afterTotal,
        decayApplied: false,
        floorApplied: false,
        reason: `${improved.length} bound taxonomy failure rate(s) improved`,
      },
    };
  }

  const confidence = 0.5;
  return {
    recommendation: "hold",
    confidence,
    rationale: "No clear improvement or regression in bound-taxonomy failure rates",
    confidenceBreakdown: {
      recommendation: "hold",
      baseConfidence: confidence,
      finalConfidence: confidence,
      repairAgeDays: 0,
      afterFailureCount: afterTotal,
      decayApplied: false,
      floorApplied: false,
      reason: "No clear improvement or regression in bound-taxonomy failure rates",
    },
  };
}

export function applyConfidenceDecayWithBreakdown(
  input: ConfidenceDecayInput
): ConfidenceBreakdown {
  const decayDays = optimizerDecayDays();
  const ageDays = input.repairAgeMs / MS_DAY;
  let decayed = input.baseConfidence;
  let decayApplied = false;
  let reason = "Evidence includes post-repair failures; base confidence retained";

  if (input.recommendation === "insufficient-data") {
    const progress = Math.min(1, ageDays / decayDays);
    decayed =
      INSUFFICIENT_DATA_BASE_CONFIDENCE -
      (INSUFFICIENT_DATA_BASE_CONFIDENCE - INSUFFICIENT_DATA_FLOOR_CONFIDENCE) * progress;
    decayApplied = true;
    reason = `Insufficient-data confidence decayed over ${ageDays.toFixed(2)} day(s)`;
  } else if (input.afterTotal === 0) {
    const factor = Math.exp(-ageDays / CONFIDENCE_HALF_LIFE_DAYS);
    decayed = input.baseConfidence * factor;
    decayApplied = true;
    reason = `No post-repair failures; confidence decayed with ${CONFIDENCE_HALF_LIFE_DAYS}d half-life`;
  }

  const finalConfidence = Math.max(CONFIDENCE_FLOOR, decayed);
  return {
    recommendation: input.recommendation,
    baseConfidence: input.baseConfidence,
    finalConfidence,
    repairAgeDays: ageDays,
    afterFailureCount: input.afterTotal,
    decayApplied,
    floorApplied: finalConfidence !== decayed,
    reason,
  };
}

export function applyConfidenceDecay(input: ConfidenceDecayInput): number {
  return applyConfidenceDecayWithBreakdown(input).finalConfidence;
}

function deriveRecommendation(
  outcomes: TaxonomyOutcomeWindow[],
  beforeTotal: number,
  afterTotal: number,
  repairAgeMs: number
): BaseRecommendation & { confidence: number; baseConfidence: number } {
  const base = computeBaseRecommendation(outcomes, beforeTotal, afterTotal);
  const confidenceBreakdown = applyConfidenceDecayWithBreakdown({
    recommendation: base.recommendation,
    baseConfidence: base.confidence,
    repairAgeMs,
    afterTotal,
  });
  return {
    ...base,
    confidence: confidenceBreakdown.finalConfidence,
    confidenceBreakdown,
    baseConfidence: base.confidence,
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
  const nowMs = options.nowMs ?? Date.now();

  for (const repair of repairs) {
    const decisionMs = new Date(repair.timestamp).getTime();
    const repairAgeMs = Math.max(0, nowMs - decisionMs);

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
      const { recommendation, confidence, confidenceBreakdown, baseConfidence, rationale } =
        deriveRecommendation(taxonomyOutcomes, beforeTotal, afterTotal, repairAgeMs);

      entries.push({
        constantKey: key,
        currentValue: defineMap.get(key)?.value,
        boundTaxonomies: taxonomyIds,
        repair,
        taxonomyOutcomes,
        clusterHitsAfter: countClusterHitsAfter(clusters, taxonomySet, decisionMs, windowMs),
        recommendation,
        confidence,
        confidenceBreakdown,
        baseConfidence,
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

function decisionWindowMs(): number {
  const days =
    typeof KIMI_DECISION_SCORE_WINDOW_DAYS === "number" ? KIMI_DECISION_SCORE_WINDOW_DAYS : 7;
  return days * MS_DAY;
}

function computeDriftPct(
  current: unknown,
  golden: unknown | undefined
): { driftPct: number | null; hasDrift: boolean } {
  if (golden === undefined) return { driftPct: null, hasDrift: false };
  if (current === golden) return { driftPct: 0, hasDrift: false };

  if (typeof golden === "number" && typeof current === "number" && golden !== 0) {
    const pct = (Math.abs(current - golden) / Math.abs(golden)) * 100;
    return { driftPct: pct, hasDrift: true };
  }

  return { driftPct: 100, hasDrift: true };
}

function failureDeltaSummary(outcomes: TaxonomyOutcomeWindow[]): string {
  const parts = outcomes
    .filter((item) => item.delta !== 0)
    .map((item) => `${item.taxonomyId} ${item.delta >= 0 ? "+" : ""}${item.delta}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function hasWorsenedFailures(outcomes: TaxonomyOutcomeWindow[]): boolean {
  return outcomes.some((item) => item.delta > 0);
}

function deriveDoctorSeverity(
  entry: ConstantOptimizerEntry,
  driftPct: number | null,
  hasDrift: boolean
): OptimizerDoctorSeverity | null {
  if (
    (entry.recommendation === "insufficient-data" || entry.recommendation === "hold") &&
    !hasDrift
  ) {
    return null;
  }

  if (
    hasDrift &&
    driftPct !== null &&
    driftPct >= 50 &&
    hasWorsenedFailures(entry.taxonomyOutcomes)
  ) {
    return "error";
  }

  if (entry.recommendation === "review" || (hasDrift && entry.confidence >= 0.7)) {
    return "warn";
  }

  if (entry.recommendation === "promote" && !hasDrift) {
    return "info";
  }

  if (hasDrift) return "warn";

  return entry.recommendation === "hold" ? null : "info";
}

function computeOutcomeStats(entry: ConstantOptimizerEntry): {
  outcomeCount: number;
  activeFailureCount: number;
  resolvedFailureCount: number;
  clusterFailureRateDelta: number | null;
} {
  const beforeTotal = entry.taxonomyOutcomes.reduce((sum, item) => sum + item.beforeCount, 0);
  const afterTotal = entry.taxonomyOutcomes.reduce((sum, item) => sum + item.afterCount, 0);
  const resolvedFailureCount = entry.taxonomyOutcomes.reduce(
    (sum, item) => sum + Math.max(0, item.beforeCount - item.afterCount),
    0
  );
  const clusterFailureRateDelta =
    beforeTotal > 0 ? Math.round(((afterTotal - beforeTotal) / beforeTotal) * 100) : null;
  return {
    outcomeCount: beforeTotal + afterTotal,
    activeFailureCount: beforeTotal,
    resolvedFailureCount,
    clusterFailureRateDelta,
  };
}

function formatDoctorValue(value: unknown): string {
  return value === undefined ? "(undefined)" : String(value);
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function buildCandidateId(decisionId: string): string {
  const slug = decisionId.replace(/[^a-z0-9]/gi, "");
  return `candidate-${slug.slice(-4).padStart(4, "0")}`;
}

function buildDoctorAction(
  optimizerAction: ConstantOptimizerRecommendation,
  hasDrift: boolean,
  candidateId?: string,
  candidateValue?: unknown
): string {
  if (hasDrift) return "kimi-heal repair-constants --dry-run";
  if (optimizerAction === "promote" && candidateValue !== undefined && candidateId !== undefined) {
    return `kimi-heal constants optimize --review ${candidateId}`;
  }
  return "kimi-heal constants optimize --json";
}

function buildDoctorMessage(
  entry: ConstantOptimizerEntry,
  goldenValue: unknown | undefined,
  driftPct: number | null,
  hasDrift: boolean,
  severity: OptimizerDoctorSeverity
): string {
  const deltaSummary = failureDeltaSummary(entry.taxonomyOutcomes);
  const driftLabel =
    driftPct === null
      ? hasDrift
        ? "drift detected"
        : "no golden"
      : `golden drift ${driftPct.toFixed(0)}%`;
  const goldenPart = goldenValue !== undefined ? `golden: ${goldenValue}` : "golden: (no snapshot)";
  const decayNote =
    entry.baseConfidence !== entry.confidence
      ? ` (decayed from ${entry.baseConfidence.toFixed(2)})`
      : "";
  return `${entry.constantKey}: current ${entry.currentValue ?? "(undefined)"}; ${goldenPart}; failures after repair: ${deltaSummary}; ${driftLabel}; optimizer ${entry.recommendation} (confidence ${entry.confidence.toFixed(2)}${decayNote}) — ${severity === "error" ? "auto-rollback review suggested" : "review suggested"}`;
}

export function formatOptimizerDoctorMessage(rec: OptimizerDoctorRecommendation): string {
  return rec.message;
}

function doctorSeverityRank(severity: OptimizerDoctorSeverity): number {
  return severity === "error" ? 3 : severity === "warn" ? 2 : 1;
}

function pickTopOptimizerRecommendation(
  recommendations: OptimizerDoctorRecommendation[]
): OptimizerDoctorRecommendation | undefined {
  return [...recommendations].sort((a, b) => {
    const severityDelta = doctorSeverityRank(b.severity) - doctorSeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.confidence - a.confidence;
  })[0];
}

function optimizerTargetValue(rec: OptimizerDoctorRecommendation): unknown {
  if (rec.candidateValue !== undefined) return rec.candidateValue;
  if (rec.goldenValue !== undefined && rec.currentValue !== rec.goldenValue) return rec.goldenValue;
  return rec.currentValue;
}

function formatOptimizerImpact(rec: OptimizerDoctorRecommendation): string {
  if (rec.resolvedFailureCount > 0) {
    const taxonomyLabel = formatOptimizerTaxonomyLabel(rec);
    return `would resolve ${rec.resolvedFailureCount} ${taxonomyLabel} error${rec.resolvedFailureCount === 1 ? "" : "s"}`;
  }
  if (rec.driftPct !== null && rec.driftPct > 0) {
    return `would restore ${Math.round(rec.driftPct)}% golden drift`;
  }
  return `needs ${rec.optimizerAction} review`;
}

export function formatOptimizerDoctorHealthMessage(
  recommendations: OptimizerDoctorRecommendation[]
): string {
  const top = pickTopOptimizerRecommendation(recommendations);
  if (!top) return "no optimizer recommendations";

  const targetValue = optimizerTargetValue(top);
  const valuePart =
    top.currentValue !== targetValue
      ? `${top.constant} ${formatDoctorValue(top.currentValue)} -> ${formatDoctorValue(targetValue)}`
      : `${top.constant} ${formatDoctorValue(top.currentValue)}`;
  const more = recommendations.length > 1 ? ` (+${recommendations.length - 1} more)` : "";
  return `Optimizer: ${valuePart} ${formatOptimizerImpact(top)} (confidence ${top.confidence.toFixed(2)})${more}`;
}

function formatOptimizerTaxonomyLabel(rec: OptimizerDoctorRecommendation): string {
  return rec.boundTaxonomies.length > 0 ? rec.boundTaxonomies.slice(0, 2).join(", ") : "bound";
}

function formatOptimizerRecommendationValueLine(rec: OptimizerDoctorRecommendation): string {
  return `${rec.constant}: ${formatDoctorValue(rec.currentValue)} → ${formatDoctorValue(optimizerTargetValue(rec))}`;
}

export function formatConfidenceBreakdownLine(breakdown: ConfidenceBreakdown): string {
  const flags = [
    breakdown.decayApplied ? "decay applied" : "no decay",
    breakdown.floorApplied ? "floor applied" : "no floor",
  ].join(", ");
  return `base ${breakdown.baseConfidence.toFixed(2)} → final ${breakdown.finalConfidence.toFixed(2)}; age ${breakdown.repairAgeDays.toFixed(2)}d; after failures ${breakdown.afterFailureCount}; ${flags}; ${breakdown.reason}`;
}

export function formatOptimizerDoctorReason(
  rec: OptimizerDoctorRecommendation,
  windowMs: number = decisionWindowMs()
): string {
  const days = Math.max(1, Math.round(windowMs / MS_DAY));
  if (rec.resolvedFailureCount > 0) {
    return `Would resolve ${rec.resolvedFailureCount} ${formatOptimizerTaxonomyLabel(rec)} error${rec.resolvedFailureCount === 1 ? "" : "s"} in the last ${days} day${days === 1 ? "" : "s"}`;
  }
  if (rec.driftPct !== null && rec.driftPct > 0) {
    return `Would restore ${Math.round(rec.driftPct)}% drift from the golden constant snapshot`;
  }
  return rec.message;
}

export function optimizerRecommendationToJson(
  rec: OptimizerDoctorRecommendation
): OptimizerDoctorJsonRecommendation {
  return {
    constant: rec.constant,
    currentValue: rec.currentValue,
    recommendedValue: optimizerTargetValue(rec),
    ...(rec.goldenValue !== undefined ? { goldenValue: rec.goldenValue } : {}),
    ...(rec.candidateValue !== undefined ? { candidateValue: rec.candidateValue } : {}),
    boundTaxonomies: rec.boundTaxonomies,
    resolvedFailureCount: rec.resolvedFailureCount,
    activeFailureCount: rec.activeFailureCount,
    reason: formatOptimizerDoctorReason(rec),
    confidence: rec.confidence,
    confidenceBreakdown: rec.confidenceBreakdown,
    reviewCommand: rec.action,
    decisionIds: rec.basedOnDecisionIds,
    severity: rec.severity,
  };
}

export function optimizerRecommendationsToJson(
  recommendations: OptimizerDoctorRecommendation[]
): OptimizerDoctorJsonRecommendation[] {
  return recommendations.map(optimizerRecommendationToJson);
}

export function printConstantOptimizerRecommendationsBlock(
  logger: Logger,
  recommendations: OptimizerDoctorRecommendation[]
): void {
  if (recommendations.length === 0) return;

  logger.section("Constant Optimizer");
  for (const rec of recommendations) {
    logger.line(`• ${formatOptimizerRecommendationValueLine(rec)}`);
    logger.line(
      `  Resolves ${rec.resolvedFailureCount} of ${rec.activeFailureCount} active failures in taxonomy`
    );
    logger.line(`  Reason: ${formatOptimizerDoctorReason(rec)}`);
    logger.line(`  Confidence: ${rec.confidence.toFixed(2)}`);
    logger.line(`  Confidence detail: ${formatConfidenceBreakdownLine(rec.confidenceBreakdown)}`);
    logger.line(`  Review with: ${rec.action}`);
  }
}

function isOptimizerDefineValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b);
}

function applyPlanItem(
  rec: OptimizerDoctorRecommendation,
  proposedValue: unknown
): OptimizerApplyPlanItem {
  return {
    constant: rec.constant,
    currentValue: rec.currentValue,
    proposedValue,
    confidence: rec.confidence,
    confidenceBreakdown: rec.confidenceBreakdown,
    reason: formatOptimizerDoctorReason(rec),
    decisionIds: rec.basedOnDecisionIds,
  };
}

export function buildOptimizerApplyPlan(
  recommendations: OptimizerDoctorRecommendation[],
  requestedConstants: string[],
  minConfidence: number
): OptimizerApplyPlan {
  const requested = requestedConstants.map((item) => item.trim()).filter(Boolean);
  const applyAll = requested.some((item) => item.toLowerCase() === "all");
  const requestedSet = new Set(requested);
  const candidates = applyAll
    ? recommendations
    : recommendations.filter((rec) => requestedSet.has(rec.constant));
  const selected: OptimizerApplyPlanItem[] = [];
  const skipped: OptimizerApplySkippedItem[] = [];

  for (const rec of candidates) {
    const proposedValue = optimizerTargetValue(rec);
    const item = applyPlanItem(rec, proposedValue);
    if (!isOptimizerDefineValue(proposedValue)) {
      skipped.push({ ...item, skipReason: "proposed value is not a Bun [define] primitive" });
      continue;
    }
    if (valuesEqual(rec.currentValue, proposedValue)) {
      skipped.push({ ...item, skipReason: "current value already matches recommendation" });
      continue;
    }
    if (rec.confidence < minConfidence) {
      skipped.push({
        ...item,
        skipReason: `confidence ${rec.confidence.toFixed(2)} is below threshold ${minConfidence.toFixed(2)}`,
      });
      continue;
    }
    selected.push(item);
  }

  if (!applyAll) {
    for (const constant of requested) {
      if (recommendations.some((rec) => rec.constant === constant)) continue;
      skipped.push({
        constant,
        currentValue: undefined,
        proposedValue: undefined,
        confidence: 0,
        confidenceBreakdown: {
          recommendation: "insufficient-data",
          baseConfidence: 0,
          finalConfidence: 0,
          repairAgeDays: 0,
          afterFailureCount: 0,
          decayApplied: false,
          floorApplied: false,
          reason: "No optimizer recommendation matched this constant",
        },
        reason: "No optimizer recommendation matched this constant",
        decisionIds: [],
        skipReason: "no matching optimizer recommendation",
      });
    }
  }

  return {
    schemaVersion: OPTIMIZER_SCHEMA_VERSION,
    minConfidence,
    requestedConstants: requested,
    selected,
    skipped,
  };
}

function formatDefineValue(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function rewriteOptimizerDefineValues(
  bunfigText: string,
  updates: OptimizerApplyPlanItem[]
): { text: string; appliedKeys: string[]; missingKeys: string[] } {
  const updateByKey = new Map(
    updates
      .filter((item) => isOptimizerDefineValue(item.proposedValue))
      .map((item) => [item.constant, item.proposedValue as string | number | boolean])
  );
  const seen = new Set<string>();
  const lines = bunfigText.split("\n");
  let inDefine = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "[define]") {
      inDefine = true;
      continue;
    }
    if (inDefine && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDefine = false;
    }
    if (!inDefine) continue;

    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^#]*?)(\s*#.*)?$/);
    const key = match?.[2];
    if (!key || !updateByKey.has(key)) continue;
    lines[i] = `${match![1]}${key} = ${formatDefineValue(updateByKey.get(key)!)}${match![4] ?? ""}`;
    seen.add(key);
  }

  return {
    text: lines.join("\n"),
    appliedKeys: [...seen].sort(),
    missingKeys: [...updateByKey.keys()].filter((key) => !seen.has(key)).sort(),
  };
}

function applyResultDetail(result: OptimizerApplyResult): string {
  if (result.selected.length === 0) {
    return `no optimizer recommendations met the apply threshold (${result.minConfidence.toFixed(2)})`;
  }
  const action = result.dryRun ? "would apply" : "applied";
  return `${action} ${result.selected.length} optimizer recommendation${result.selected.length === 1 ? "" : "s"}: ${result.selected.map((item) => item.constant).join(", ")}`;
}

export function formatOptimizerApplyResultLines(result: OptimizerApplyResult): string[] {
  const lines: string[] = [];
  const action = result.dryRun ? "Would apply" : "Applied";
  for (const item of result.selected) {
    lines.push(
      `${action} ${item.constant}: ${formatDoctorValue(item.currentValue)} → ${formatDoctorValue(item.proposedValue)} (confidence ${item.confidence.toFixed(2)})`
    );
    lines.push(`  Confidence detail: ${formatConfidenceBreakdownLine(item.confidenceBreakdown)}`);
    lines.push(`  Reason: ${item.reason}`);
  }
  for (const item of result.skipped) {
    lines.push(`Skipped ${item.constant}: ${item.skipReason}`);
  }
  if (result.dryRun && result.selected.length > 0) {
    lines.push("Dry run — pass --yes to write bunfig.toml");
  }
  if (result.decisionIds.length > 0) {
    lines.push(
      `Decision${result.decisionIds.length === 1 ? "" : "s"}: ${result.decisionIds.join(", ")}`
    );
  }
  return lines;
}

export function applyOptimizerRecommendationsEffect(input: {
  projectRoot: string;
  recommendations: OptimizerDoctorRecommendation[];
  requestedConstants: string[];
  minConfidence: number;
  dryRun: boolean;
  traceId: string;
}): Effect.Effect<OptimizerApplyResult, unknown> {
  const plan = buildOptimizerApplyPlan(
    input.recommendations,
    input.requestedConstants,
    input.minConfidence
  );
  const root = input.projectRoot.endsWith("/") ? input.projectRoot.slice(0, -1) : input.projectRoot;
  const bunfigPath = `${root}/bunfig.toml`;

  return Effect.gen(function* () {
    if (plan.selected.length === 0) {
      const result: OptimizerApplyResult = {
        ...plan,
        applied: false,
        dryRun: input.dryRun,
        bunfigPath,
        decisionIds: [],
        detail: "",
      };
      return { ...result, detail: applyResultDetail(result) };
    }

    const bunfigText = yield* Effect.tryPromise({
      try: () => Bun.file(bunfigPath).text(),
      catch: (error) => error,
    });
    const rewrite = rewriteOptimizerDefineValues(bunfigText, plan.selected);
    const missingSelected = new Set(rewrite.missingKeys);
    const selected = plan.selected.filter((item) => !missingSelected.has(item.constant));
    const skipped = [
      ...plan.skipped,
      ...plan.selected
        .filter((item) => missingSelected.has(item.constant))
        .map((item) => ({ ...item, skipReason: "constant not found in bunfig.toml [define]" })),
    ];
    const resolvedPlan: OptimizerApplyPlan = { ...plan, selected, skipped };

    if (input.dryRun || selected.length === 0) {
      const result: OptimizerApplyResult = {
        ...resolvedPlan,
        applied: false,
        dryRun: true,
        bunfigPath,
        decisionIds: [],
        rewrittenBunfig: rewrite.text,
        detail: "",
      };
      return { ...result, detail: applyResultDetail(result) };
    }

    yield* Effect.tryPromise({
      try: () => Bun.write(bunfigPath, rewrite.text),
      catch: (error) => error,
    });

    const decisions = yield* Effect.all(
      selected.map((item) =>
        logDecisionEffect(
          {
            action: "config-change",
            trigger: { traceId: input.traceId, capabilityItem: item.constant },
            metadata: {
              type: "constant-optimization",
              constantKey: item.constant,
              previousValue: item.currentValue,
              candidateValue: item.proposedValue,
              confidence: item.confidence,
              confidenceBreakdown: item.confidenceBreakdown,
              minConfidence: input.minConfidence,
              basedOnDecisionIds: item.decisionIds,
            },
            rationaleOverride: {
              summary: `Applied optimizer recommendation for ${item.constant}`,
              fullReasoning: `Rewrote bunfig.toml [define] ${item.constant} from ${formatDoctorValue(item.currentValue)} to ${formatDoctorValue(item.proposedValue)} after confidence ${item.confidence.toFixed(2)} met threshold ${input.minConfidence.toFixed(2)}. ${item.reason}.`,
              evidence: [
                {
                  type: "contractDiff",
                  detail: `${item.constant}: ${formatDoctorValue(item.currentValue)} -> ${formatDoctorValue(item.proposedValue)}; basedOn=${item.decisionIds.join(",")}`,
                },
              ],
            },
            outcome: { result: "success", verifiedAt: new Date().toISOString() },
          },
          { projectRoot: input.projectRoot }
        )
      ),
      { concurrency: 1 }
    );

    const result: OptimizerApplyResult = {
      ...resolvedPlan,
      applied: selected.length > 0,
      dryRun: false,
      bunfigPath,
      decisionIds: decisions.map((decision) => decision.decisionId),
      rewrittenBunfig: rewrite.text,
      detail: "",
    };
    return { ...result, detail: applyResultDetail(result) };
  });
}

export function formatOptimizerDoctorDetailLines(rec: OptimizerDoctorRecommendation): string[] {
  const lines: string[] = [`  • ${rec.constant}`];

  if (rec.driftPct !== null && rec.driftPct > 0) {
    lines.push(
      `    Current: ${formatDoctorValue(rec.currentValue)} | Golden: ${formatDoctorValue(rec.goldenValue)} | Drift: ${formatSignedPercent(Math.round(rec.driftPct))}`
    );
    const failureRate =
      rec.clusterFailureRateDelta === null
        ? "n/a"
        : formatSignedPercent(rec.clusterFailureRateDelta);
    lines.push(
      `    Last review: ${formatAgeShort(rec.lastReviewMs)} | Cluster failure rate: ${failureRate}`
    );
    lines.push(`    Action: ${rec.action}`);
    return lines;
  }

  let valueLine = `    Current: ${formatDoctorValue(rec.currentValue)} | Golden: ${formatDoctorValue(rec.goldenValue)}`;
  if (rec.candidateValue !== undefined) {
    valueLine += ` | Candidate: ${formatDoctorValue(rec.candidateValue)}`;
  }
  lines.push(valueLine);
  lines.push(
    `    Confidence: ${rec.confidence.toFixed(2)} | Based on: ${rec.outcomeCount} heal outcome${rec.outcomeCount === 1 ? "" : "s"}`
  );
  lines.push(`    Action: ${rec.action}`);
  return lines;
}

export function summarizeOptimizerDoctorBlock(recommendations: OptimizerDoctorRecommendation[]): {
  status: "ok" | "warn" | "error";
  message: string;
} {
  if (recommendations.length === 0) {
    return { status: "ok", message: "no optimizer recommendations" };
  }
  if (recommendations.some((rec) => rec.severity === "error")) {
    return {
      status: "error",
      message: `${recommendations.length} constant(s) need urgent review`,
    };
  }
  if (recommendations.some((rec) => rec.severity === "warn")) {
    return {
      status: "warn",
      message: `${recommendations.length} constant(s) need review`,
    };
  }
  return {
    status: "ok",
    message: `${recommendations.length} constant(s) tracked — no action required`,
  };
}

export function printConstantOptimizerDoctorBlock(
  logger: Logger,
  recommendations: OptimizerDoctorRecommendation[]
): void {
  const summary = summarizeOptimizerDoctorBlock(recommendations);
  logger.check({
    name: "Optimizer",
    status: summary.status,
    message: formatOptimizerDoctorHealthMessage(recommendations),
    fixable: false,
  });

  for (const rec of recommendations) {
    if (rec.severity === "info") continue;
    for (const line of formatOptimizerDoctorDetailLines(rec)) {
      logger.line(line);
    }
  }
}

export function mapDoctorSeverityToCheckStatus(
  severity: OptimizerDoctorSeverity
): "ok" | "warn" | "error" {
  if (severity === "error") return "error";
  if (severity === "warn") return "warn";
  return "ok";
}

export function entryToDoctorRecommendation(
  entry: ConstantOptimizerEntry,
  goldenValue: unknown | undefined,
  options: { nowMs?: number; candidateValue?: unknown } = {}
): OptimizerDoctorRecommendation | null {
  const { driftPct, hasDrift } = computeDriftPct(entry.currentValue, goldenValue);
  const severity = deriveDoctorSeverity(entry, driftPct, hasDrift);
  if (!severity) return null;

  const nowMs = options.nowMs ?? Date.now();
  const { outcomeCount, activeFailureCount, resolvedFailureCount, clusterFailureRateDelta } =
    computeOutcomeStats(entry);
  const lastReviewMs = Math.max(0, nowMs - new Date(entry.repair.timestamp).getTime());
  const candidateId =
    entry.recommendation === "promote" && options.candidateValue !== undefined
      ? buildCandidateId(entry.repair.decisionId)
      : undefined;
  const action = buildDoctorAction(
    entry.recommendation,
    hasDrift,
    candidateId,
    options.candidateValue
  );
  return {
    constant: entry.constantKey,
    currentValue: entry.currentValue,
    goldenValue,
    candidateValue: options.candidateValue,
    candidateId,
    boundTaxonomies: entry.boundTaxonomies,
    driftPct,
    confidence: entry.confidence,
    confidenceBreakdown: entry.confidenceBreakdown,
    baseConfidence: entry.baseConfidence,
    basedOnDecisionIds: [entry.repair.decisionId],
    outcomeCount,
    activeFailureCount,
    resolvedFailureCount,
    lastReviewMs,
    clusterFailureRateDelta,
    optimizerAction: entry.recommendation,
    severity,
    action,
    message: buildDoctorMessage(entry, goldenValue, driftPct, hasDrift, severity),
  };
}

export async function generateOptimizerDoctorRecommendations(
  projectRoot: string,
  options: {
    failurePath?: string;
    windowMs?: number;
    nowMs?: number;
  } = {}
): Promise<OptimizerDoctorRecommendation[]> {
  const windowMs = options.windowMs ?? decisionWindowMs();
  const report = await buildConstantOptimizerReport(projectRoot, {
    ...options,
    windowMs,
  });
  const golden = await loadConstantsGolden(projectRoot);
  const decisions = await readDecisions(projectRoot);
  const candidateProposals = collectCandidateProposals(decisions);
  const recommendations: OptimizerDoctorRecommendation[] = [];

  const nowMs = options.nowMs ?? Date.now();
  for (const entry of report.entries) {
    const goldenValue = golden?.constants[entry.constantKey]?.value;
    const candidateValue = candidateProposals.get(entry.constantKey);
    const rec = entryToDoctorRecommendation(entry, goldenValue, { nowMs, candidateValue });
    if (rec) recommendations.push(rec);
  }

  return recommendations;
}

export function generateOptimizerDoctorRecommendationsEffect(
  projectRoot: string,
  options: {
    failurePath?: string;
    windowMs?: number;
    nowMs?: number;
  } = {}
): Effect.Effect<OptimizerDoctorRecommendation[]> {
  return Effect.tryPromise({
    try: () => generateOptimizerDoctorRecommendations(projectRoot, options),
    catch: () => "optimizer-recommendations-failed",
  }).pipe(Effect.catchAll(() => Effect.succeed([])));
}

export interface OptimizerDoctorMachineCheck {
  name: string;
  status: "ok" | "warn" | "error";
  source: "constant-optimizer";
  severity: OptimizerDoctorSeverity;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  baseConfidence?: number;
  driftPercent: number | null;
  action: string;
  decisionIds: string[];
  constant: string;
  candidateId?: string;
  candidateValue?: unknown;
  message: string;
}

export function optimizerRecommendationToMachineCheck(
  rec: OptimizerDoctorRecommendation
): OptimizerDoctorMachineCheck {
  return {
    name: `constant-optimizer:${rec.constant}`,
    status: mapDoctorSeverityToCheckStatus(rec.severity),
    source: "constant-optimizer",
    severity: rec.severity,
    confidence: rec.confidence,
    confidenceBreakdown: rec.confidenceBreakdown,
    baseConfidence: rec.baseConfidence,
    driftPercent: rec.driftPct,
    action: rec.action,
    decisionIds: rec.basedOnDecisionIds,
    constant: rec.constant,
    candidateId: rec.candidateId,
    candidateValue: rec.candidateValue,
    message: rec.message,
  };
}

export async function buildOptimizerDoctorMachineChecks(
  projectRoot: string,
  options: {
    failurePath?: string;
    windowMs?: number;
    nowMs?: number;
  } = {}
): Promise<OptimizerDoctorMachineCheck[]> {
  const recommendations = await generateOptimizerDoctorRecommendations(projectRoot, options);
  if (recommendations.length === 0) {
    return [
      {
        name: "constant-optimizer:summary",
        status: "ok",
        source: "constant-optimizer",
        severity: "info",
        confidence: 0,
        driftPercent: null,
        action: "",
        decisionIds: [],
        constant: "summary",
        message: "no optimizer recommendations",
      },
    ];
  }
  return recommendations.map(optimizerRecommendationToMachineCheck);
}
