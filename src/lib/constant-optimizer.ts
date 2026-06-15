/**
 * Phase 3 skeleton — correlate bound-constant repairs with taxonomy/cluster outcomes.
 */

import { readDecisions, type Decision } from "./decision-ledger.ts";
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
  driftPct: number | null;
  confidence: number;
  basedOnDecisionIds: string[];
  outcomeCount: number;
  lastReviewMs: number;
  clusterFailureRateDelta: number | null;
  optimizerAction: ConstantOptimizerRecommendation;
  severity: OptimizerDoctorSeverity;
  action: string;
  message: string;
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
  clusterFailureRateDelta: number | null;
} {
  const beforeTotal = entry.taxonomyOutcomes.reduce((sum, item) => sum + item.beforeCount, 0);
  const afterTotal = entry.taxonomyOutcomes.reduce((sum, item) => sum + item.afterCount, 0);
  const clusterFailureRateDelta =
    beforeTotal > 0 ? Math.round(((afterTotal - beforeTotal) / beforeTotal) * 100) : null;
  return { outcomeCount: beforeTotal + afterTotal, clusterFailureRateDelta };
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
  return `${entry.constantKey}: current ${entry.currentValue ?? "(undefined)"}; ${goldenPart}; failures after repair: ${deltaSummary}; ${driftLabel}; optimizer ${entry.recommendation} (confidence ${entry.confidence.toFixed(2)}) — ${severity === "error" ? "auto-rollback review suggested" : "review suggested"}`;
}

export function formatOptimizerDoctorMessage(rec: OptimizerDoctorRecommendation): string {
  return rec.message;
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
    name: "constant-optimizer",
    status: summary.status,
    message: summary.message,
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
  const { outcomeCount, clusterFailureRateDelta } = computeOutcomeStats(entry);
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
    driftPct,
    confidence: entry.confidence,
    basedOnDecisionIds: [entry.repair.decisionId],
    outcomeCount,
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

export interface OptimizerDoctorMachineCheck {
  name: string;
  status: "ok" | "warn" | "error";
  source: "constant-optimizer";
  severity: OptimizerDoctorSeverity;
  confidence: number;
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
