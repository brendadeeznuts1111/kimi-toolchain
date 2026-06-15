/**
 * Predictive doctor — project-local health snapshots and trend analysis.
 */

import { existsSync } from "fs";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import { healthSnapshotsPath } from "./paths.ts";
import { getProjectName } from "./utils.ts";
import { readDecisions, type Decision } from "./decision-ledger.ts";

export const HEALTH_SNAPSHOT_SCHEMA_VERSION = 1;

const MAX_HEALTH_SNAPSHOTS = 1000;
const SNAPSHOT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SCORE_THRESHOLD = 80;

type Status = "ok" | "warn" | "error";

export interface PredictiveHealthCheck {
  name: string;
  status: Status;
  message?: string;
  fixable?: boolean;
  category?: string;
  taxonomyId?: string;
}

export interface HealthSnapshotCheck {
  name: string;
  status: Status;
  fixable: boolean;
  category?: string;
}

export interface HealthSnapshotSummary {
  total: number;
  ok: number;
  warn: number;
  error: number;
  fixable: number;
}

export interface HealthSnapshot {
  schemaVersion: typeof HEALTH_SNAPSHOT_SCHEMA_VERSION;
  timestamp: string;
  project: string;
  score: number;
  checks: HealthSnapshotCheck[];
  summary: HealthSnapshotSummary;
  decisionVelocity: number;
  activeDriftCount: number;
  ecosystem?: {
    blockers: number;
    warnings: number;
    errors: number;
  };
  gitHead?: string;
}

export interface BuildHealthSnapshotInput {
  checks: PredictiveHealthCheck[];
  ecosystem?: HealthSnapshot["ecosystem"];
  gitHead?: string;
  nowMs?: number;
}

export interface Anomaly {
  kind: "score" | "check";
  name: string;
  timestamp: string;
  current: number;
  mean: number;
  stddev: number;
  threshold: number;
  severity: "warn" | "error";
  message: string;
}

export interface DecisionVelocityReport {
  decisionType?: string;
  currentWindowMs: number;
  baselineWindowMs: number;
  currentCount: number;
  baselineCount: number;
  currentPerHour: number;
  baselinePerHour: number;
  ratio: number | null;
  alert: boolean;
  message: string;
}

export interface BreachPrediction {
  status: "insufficient-data" | "stable" | "breaching" | "predicted";
  horizonHours: number;
  threshold: number;
  currentScore?: number;
  slopePerHour?: number;
  predictedScore?: number;
  hoursToThreshold?: number;
  message: string;
}

export interface HealthCorrelation {
  fromTimestamp: string;
  toTimestamp: string;
  scoreDelta: number;
  decisions: Array<{
    decisionId: string;
    timestamp: string;
    type: string;
    target: string;
    summary: string;
  }>;
}

const WINDOW_MS: Record<"d" | "h" | "m", number> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
};

export function parsePredictiveWindow(value: string): number {
  const match = value.trim().match(/^(\d+)(d|h|m)$/i);
  if (!match) throw new Error(`Invalid window "${value}" — use 7d, 24h, or 30m`);
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase() as "d" | "h" | "m";
  return amount * WINDOW_MS[unit];
}

function scoreStatus(status: Status): number {
  if (status === "error") return 2;
  if (status === "warn") return 1;
  return 0;
}

function summarizeChecks(checks: HealthSnapshotCheck[]): HealthSnapshotSummary {
  return {
    total: checks.length,
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    error: checks.filter((check) => check.status === "error").length,
    fixable: checks.filter((check) => check.fixable).length,
  };
}

export function computeHealthScore(
  summary: Pick<HealthSnapshotSummary, "total" | "warn" | "error">
): number {
  if (summary.total === 0) return 100;
  const penalty = summary.error * 20 + summary.warn * 5;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function normalizeChecks(checks: PredictiveHealthCheck[]): HealthSnapshotCheck[] {
  return checks
    .map((check) => ({
      name: check.name,
      status: check.status,
      fixable: !!check.fixable,
      category: check.taxonomyId ?? check.category,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function activeDriftCount(checks: HealthSnapshotCheck[]): number {
  return checks.filter((check) => {
    if (check.status === "ok") return false;
    const text = `${check.name} ${check.category ?? ""}`.toLowerCase();
    return text.includes("drift") || text.includes("constant") || text.includes("optimizer");
  }).length;
}

function snapshotFingerprint(
  snapshot: Pick<HealthSnapshot, "checks" | "score" | "summary">
): string {
  return JSON.stringify({
    score: snapshot.score,
    summary: snapshot.summary,
    checks: snapshot.checks.map((check) => ({
      name: check.name,
      status: check.status,
      category: check.category,
    })),
  });
}

function isHealthSnapshot(value: unknown): value is HealthSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === HEALTH_SNAPSHOT_SCHEMA_VERSION &&
    typeof record.timestamp === "string" &&
    typeof record.project === "string" &&
    typeof record.score === "number" &&
    Array.isArray(record.checks) &&
    !!record.summary &&
    typeof record.summary === "object"
  );
}

async function pruneHealthSnapshots(path: string): Promise<void> {
  const records = await readNdjsonFile<HealthSnapshot>(path, isHealthSnapshot);
  if (records.length <= MAX_HEALTH_SNAPSHOTS) return;
  const trimmed = records.slice(-MAX_HEALTH_SNAPSHOTS);
  await Bun.write(path, `${trimmed.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function shouldSkipAppend(
  path: string,
  snapshot: HealthSnapshot,
  nowMs: number
): Promise<boolean> {
  const records = await readNdjsonFile<HealthSnapshot>(path, isHealthSnapshot);
  const last = records.at(-1);
  if (!last) return false;
  const lastMs = Date.parse(last.timestamp);
  if (!Number.isFinite(lastMs) || nowMs - lastMs >= SNAPSHOT_DEDUPE_WINDOW_MS) return false;
  return snapshotFingerprint(last) === snapshotFingerprint(snapshot);
}

export function computeDecisionVelocity(
  decisions: Decision[],
  currentWindowMs: number,
  baselineWindowMs: number,
  options: { nowMs?: number; decisionType?: string } = {}
): DecisionVelocityReport {
  const nowMs = options.nowMs ?? Date.now();
  const currentStart = nowMs - currentWindowMs;
  const baselineStart = currentStart - baselineWindowMs;
  const typed = options.decisionType
    ? decisions.filter((decision) => decision.metadata?.type === options.decisionType)
    : decisions;

  const currentCount = typed.filter((decision) => {
    const ts = Date.parse(decision.timestamp);
    return ts >= currentStart && ts <= nowMs;
  }).length;
  const baselineCount = typed.filter((decision) => {
    const ts = Date.parse(decision.timestamp);
    return ts >= baselineStart && ts < currentStart;
  }).length;

  const currentPerHour = currentCount / Math.max(1, currentWindowMs / 3_600_000);
  const baselinePerHour = baselineCount / Math.max(1, baselineWindowMs / 3_600_000);
  const ratio =
    baselinePerHour > 0 ? currentPerHour / baselinePerHour : currentCount > 0 ? null : 0;
  const alert =
    currentCount >= 5 &&
    (baselineCount === 0 || currentPerHour >= Math.max(1, baselinePerHour * 3));
  const baselineLabel = baselineCount === 0 ? "no baseline decisions" : `${baselineCount} baseline`;

  return {
    decisionType: options.decisionType,
    currentWindowMs,
    baselineWindowMs,
    currentCount,
    baselineCount,
    currentPerHour: Math.round(currentPerHour * 100) / 100,
    baselinePerHour: Math.round(baselinePerHour * 100) / 100,
    ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
    alert,
    message: `${currentCount} decision(s) in current window vs ${baselineLabel}`,
  };
}

export async function buildHealthSnapshot(
  projectRoot: string,
  input: BuildHealthSnapshotInput
): Promise<HealthSnapshot> {
  const nowMs = input.nowMs ?? Date.now();
  const checks = normalizeChecks(input.checks);
  const summary = summarizeChecks(checks);
  const decisions = await readDecisions(projectRoot);
  const velocity = computeDecisionVelocity(
    decisions,
    24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    {
      nowMs,
    }
  );

  return {
    schemaVersion: HEALTH_SNAPSHOT_SCHEMA_VERSION,
    timestamp: new Date(nowMs).toISOString(),
    project: await getProjectName(projectRoot),
    score: computeHealthScore(summary),
    checks,
    summary,
    decisionVelocity: velocity.currentPerHour,
    activeDriftCount: activeDriftCount(checks),
    ecosystem: input.ecosystem,
    gitHead: input.gitHead,
  };
}

export async function appendHealthSnapshot(
  projectRoot: string,
  input: BuildHealthSnapshotInput
): Promise<HealthSnapshot | null> {
  const snapshot = await buildHealthSnapshot(projectRoot, input);
  const path = healthSnapshotsPath(projectRoot);
  const nowMs = input.nowMs ?? Date.now();
  if (await shouldSkipAppend(path, snapshot, nowMs)) return null;
  await appendNdjsonRecord(path, snapshot);
  if (existsSync(path)) await pruneHealthSnapshots(path);
  return snapshot;
}

export async function readHealthSnapshots(
  projectRoot: string,
  options: { windowMs?: number; nowMs?: number; limit?: number } = {}
): Promise<HealthSnapshot[]> {
  const path = healthSnapshotsPath(projectRoot);
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_HISTORY_WINDOW_MS;
  const sinceMs = nowMs - windowMs;
  const records = await readNdjsonFile<HealthSnapshot>(path, isHealthSnapshot);
  return records
    .filter((record) => {
      const ts = Date.parse(record.timestamp);
      return Number.isFinite(ts) && ts >= sinceMs && ts <= nowMs;
    })
    .slice(-(options.limit ?? MAX_HEALTH_SNAPSHOTS));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function detectAnomalies(
  history: HealthSnapshot[],
  windowMs = DEFAULT_HISTORY_WINDOW_MS
): Anomaly[] {
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = sorted.at(-1);
  if (!latest || sorted.length < 3) return [];

  const latestMs = Date.parse(latest.timestamp);
  const baseline = sorted.filter((snapshot) => {
    const ts = Date.parse(snapshot.timestamp);
    return snapshot.timestamp < latest.timestamp && latestMs - ts <= windowMs;
  });
  if (baseline.length < 2) return [];

  const anomalies: Anomaly[] = [];
  const scoreValues = baseline.map((snapshot) => snapshot.score);
  const scoreMean = mean(scoreValues);
  const scoreStddev = stddev(scoreValues, scoreMean);
  const scoreThreshold = scoreMean - 2 * scoreStddev;
  if (latest.score < scoreThreshold) {
    anomalies.push({
      kind: "score",
      name: "health-score",
      timestamp: latest.timestamp,
      current: latest.score,
      mean: Math.round(scoreMean * 100) / 100,
      stddev: Math.round(scoreStddev * 100) / 100,
      threshold: Math.round(scoreThreshold * 100) / 100,
      severity: latest.score < scoreThreshold - 10 ? "error" : "warn",
      message: `health score ${latest.score} is below baseline ${Math.round(scoreMean)}`,
    });
  }

  for (const check of latest.checks) {
    const values = baseline
      .map((snapshot) => snapshot.checks.find((candidate) => candidate.name === check.name))
      .filter((candidate): candidate is HealthSnapshotCheck => !!candidate)
      .map((candidate) => scoreStatus(candidate.status));
    if (values.length < 2) continue;
    const avg = mean(values);
    const sigma = stddev(values, avg);
    const threshold = avg + 2 * sigma;
    const current = scoreStatus(check.status);
    if (current > threshold) {
      anomalies.push({
        kind: "check",
        name: check.name,
        timestamp: latest.timestamp,
        current,
        mean: Math.round(avg * 100) / 100,
        stddev: Math.round(sigma * 100) / 100,
        threshold: Math.round(threshold * 100) / 100,
        severity: check.status === "error" ? "error" : "warn",
        message: `${check.name} moved to ${check.status} from stable baseline`,
      });
    }
  }

  return anomalies;
}

export function predictThresholdBreach(
  history: HealthSnapshot[],
  options: { horizonHours?: number; threshold?: number } = {}
): BreachPrediction {
  const horizonHours = options.horizonHours ?? 6;
  const threshold = options.threshold ?? DEFAULT_SCORE_THRESHOLD;
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length < 3) {
    return {
      status: "insufficient-data",
      horizonHours,
      threshold,
      message: "need at least 3 health snapshots before prediction",
    };
  }

  const firstMs = Date.parse(sorted[0]!.timestamp);
  const points = sorted.map((snapshot) => ({
    x: (Date.parse(snapshot.timestamp) - firstMs) / 3_600_000,
    y: snapshot.score,
  }));
  const avgX = mean(points.map((point) => point.x));
  const avgY = mean(points.map((point) => point.y));
  const denominator = points.reduce((sum, point) => sum + (point.x - avgX) ** 2, 0);
  if (denominator === 0) {
    return { status: "stable", horizonHours, threshold, message: "health trend is flat" };
  }
  const slope =
    points.reduce((sum, point) => sum + (point.x - avgX) * (point.y - avgY), 0) / denominator;
  const latest = sorted.at(-1)!;
  const currentScore = latest.score;
  const predictedScore = currentScore + slope * horizonHours;

  if (currentScore <= threshold) {
    return {
      status: "breaching",
      horizonHours,
      threshold,
      currentScore,
      slopePerHour: Math.round(slope * 1000) / 1000,
      predictedScore: Math.round(predictedScore * 100) / 100,
      hoursToThreshold: 0,
      message: `health score already at or below ${threshold}`,
    };
  }

  if (slope >= 0) {
    return {
      status: "stable",
      horizonHours,
      threshold,
      currentScore,
      slopePerHour: Math.round(slope * 1000) / 1000,
      predictedScore: Math.round(predictedScore * 100) / 100,
      message: "health trend is stable or improving",
    };
  }

  const hoursToThreshold = (threshold - currentScore) / slope;
  const roundedHours = Math.round(hoursToThreshold * 100) / 100;
  return {
    status: hoursToThreshold <= horizonHours ? "predicted" : "stable",
    horizonHours,
    threshold,
    currentScore,
    slopePerHour: Math.round(slope * 1000) / 1000,
    predictedScore: Math.round(predictedScore * 100) / 100,
    hoursToThreshold: roundedHours,
    message:
      hoursToThreshold <= horizonHours
        ? `health score trending toward ${threshold} in ${roundedHours}h`
        : `health score trending down but outside ${horizonHours}h horizon`,
  };
}

function constantDecisionTarget(decision: Decision): string {
  const constantKey = decision.metadata?.constantKey;
  if (typeof constantKey === "string") return constantKey;
  const restored = decision.metadata?.restoredKeys;
  if (Array.isArray(restored)) {
    return restored.filter((key): key is string => typeof key === "string").join(",");
  }
  const captured = decision.metadata?.capturedKeys;
  if (Array.isArray(captured)) {
    return captured
      .filter((key): key is string => typeof key === "string")
      .slice(0, 3)
      .join(",");
  }
  return decision.trigger.capabilityItem ?? decision.trigger.clusterId ?? decision.trigger.traceId;
}

function isConstantDecision(decision: Decision): boolean {
  const type = decision.metadata?.type;
  return (
    type === "constant-repair" || type === "constant-drift-accept" || type === "constant-optimizer"
  );
}

export function correlateHealthWithConstants(
  history: HealthSnapshot[],
  decisions: Decision[],
  options: { minScoreDrop?: number; lookbackMs?: number } = {}
): HealthCorrelation[] {
  const minScoreDrop = options.minScoreDrop ?? 5;
  const lookbackMs = options.lookbackMs ?? 24 * 60 * 60 * 1000;
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const correlations: HealthCorrelation[] = [];

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const scoreDelta = current.score - previous.score;
    if (scoreDelta > -minScoreDrop) continue;
    const previousMs = Date.parse(previous.timestamp);
    const currentMs = Date.parse(current.timestamp);
    const windowStart = previousMs - lookbackMs;
    const related = decisions.filter((decision) => {
      if (!isConstantDecision(decision)) return false;
      const ts = Date.parse(decision.timestamp);
      return ts >= windowStart && ts <= currentMs;
    });
    if (related.length === 0) continue;
    correlations.push({
      fromTimestamp: previous.timestamp,
      toTimestamp: current.timestamp,
      scoreDelta,
      decisions: related.map((decision) => ({
        decisionId: decision.decisionId,
        timestamp: decision.timestamp,
        type: String(decision.metadata?.type ?? decision.action),
        target: constantDecisionTarget(decision),
        summary: decision.rationale.summary,
      })),
    });
  }

  return correlations;
}
