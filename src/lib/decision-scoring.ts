/**
 * Decision quality scoring based on follow-up failure outcomes.
 */

import { Data, Effect } from "effect";
import type { FailureTraceRecord } from "./failure-ledger.ts";
import { readFailureRecords } from "./failure-ledger.ts";
import { readDecisions, type DecisionRecord } from "./decision-ledger.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEAL_RECURS_WITHIN_24H_SCORE = 0.2;
const HEAL_STABLE_7D_SCORE = 1.0;

export interface DecisionScoringContext {
  now?: Date;
  decisions?: readonly DecisionRecord[];
  failures?: readonly FailureTraceRecord[];
  failureTimestampsByCluster?: ReadonlyMap<string, readonly number[]>;
  decisionById?: ReadonlyMap<string, DecisionRecord>;
}

export interface ScoreDecisionsOptions {
  failurePath?: string;
  now?: Date;
}

export class DecisionScoringError extends Data.TaggedError("DecisionScoringError")<{
  message: string;
  failurePath?: string;
}> {}

export function scoreDecision(
  record: DecisionRecord,
  context: DecisionScoringContext = {}
): number {
  const decisionAtMs = Date.parse(record.timestamp);
  if (!Number.isFinite(decisionAtMs)) return 0;

  const nowMs = context.now ? context.now.getTime() : Date.now();
  const decisionById = context.decisionById ?? buildDecisionById(context.decisions ?? []);
  const failuresByCluster =
    context.failureTimestampsByCluster ?? buildFailureTimestampsByCluster(context.failures ?? []);

  let score = baseOutcomeScore(record);
  const clusterId = record.clusterId ?? record.trigger.clusterId;
  if (clusterId && isHealOrClusterAction(record.action) && record.outcome.result === "success") {
    score = applyClusterStabilityRule(score, clusterId, decisionAtMs, nowMs, failuresByCluster);
  }

  const parent = record.parentDecisionId ? decisionById.get(record.parentDecisionId) : undefined;
  if (parent) {
    score = applyParentPatternRule(score, record, parent);
  }

  return clamp01(score);
}

export async function scoreDecisions(
  records: readonly DecisionRecord[],
  options: ScoreDecisionsOptions = {}
): Promise<Map<string, number>> {
  const failures = await readFailureRecords(options.failurePath);
  const decisionById = buildDecisionById(records);
  const failureTimestampsByCluster = buildFailureTimestampsByCluster(failures);
  const context: DecisionScoringContext = {
    now: options.now,
    decisions: records,
    failures,
    decisionById,
    failureTimestampsByCluster,
  };

  const updates = new Map<string, number>();
  for (const record of records) {
    updates.set(record.decisionId, scoreDecision(record, context));
  }
  return updates;
}

export function scoreDecisionsEffect(
  records: readonly DecisionRecord[],
  options: ScoreDecisionsOptions = {}
): Effect.Effect<Map<string, number>, DecisionScoringError> {
  return Effect.tryPromise({
    try: () => scoreDecisions(records, options),
    catch: (error) =>
      new DecisionScoringError({
        message: error instanceof Error ? error.message : Bun.inspect(error),
        failurePath: options.failurePath,
      }),
  });
}

function applyClusterStabilityRule(
  currentScore: number,
  clusterId: string,
  decisionAtMs: number,
  nowMs: number,
  failuresByCluster: ReadonlyMap<string, readonly number[]>
): number {
  const clusterFailures = failuresByCluster.get(clusterId) ?? [];
  const horizonEndMs = Math.min(nowMs, decisionAtMs + 7 * DAY_MS);
  const relevant = clusterFailures.filter(
    (timestamp) => timestamp > decisionAtMs && timestamp <= nowMs
  );

  const hasRecurrenceWithin24h = relevant.some((timestamp) => timestamp <= decisionAtMs + DAY_MS);
  if (hasRecurrenceWithin24h) return HEAL_RECURS_WITHIN_24H_SCORE;

  const hasRecurrenceWithin7d = relevant.some(
    (timestamp) => timestamp <= decisionAtMs + 7 * DAY_MS
  );
  const observedFullWindow = horizonEndMs >= decisionAtMs + 7 * DAY_MS;
  if (!hasRecurrenceWithin7d && observedFullWindow) {
    return Math.max(currentScore, HEAL_STABLE_7D_SCORE);
  }

  return Math.max(currentScore, 0.7);
}

function applyParentPatternRule(
  currentScore: number,
  record: DecisionRecord,
  parent: DecisionRecord
): number {
  const action = record.action.toLowerCase();
  const corrective =
    action.includes("rollback") ||
    action.includes("revert") ||
    action.includes("correct") ||
    action.includes("fix") ||
    action.includes("heal");

  if (!corrective) return currentScore;
  if (record.outcome.result === "success" && parent.outcome.result === "failure") {
    return Math.max(currentScore, 0.85);
  }
  if (record.outcome.result === "failure" && parent.outcome.result === "success") {
    return Math.min(currentScore, 0.3);
  }
  if (
    record.outcome.result === "success" &&
    parent.qualityScore !== undefined &&
    parent.qualityScore < 0.4
  ) {
    return Math.max(currentScore, 0.8);
  }
  return currentScore;
}

function baseOutcomeScore(record: DecisionRecord): number {
  if (record.outcome.result === "success") return 0.6;
  if (record.outcome.result === "failure") return 0.2;
  return 0.4;
}

function isHealOrClusterAction(action: string): boolean {
  const value = action.toLowerCase();
  return value.includes("heal") || value.includes("cluster");
}

function buildDecisionById(records: readonly DecisionRecord[]): Map<string, DecisionRecord> {
  return new Map(records.map((record) => [record.decisionId, record]));
}

function buildFailureTimestampsByCluster(
  failures: readonly FailureTraceRecord[]
): Map<string, readonly number[]> {
  const index = new Map<string, number[]>();
  for (const failure of failures) {
    if (!failure.clusterId || !failure.timestamp) continue;
    const timestamp = Date.parse(failure.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const items = index.get(failure.clusterId) ?? [];
    items.push(timestamp);
    index.set(failure.clusterId, items);
  }
  for (const [clusterId, timestamps] of index.entries()) {
    timestamps.sort((a, b) => a - b);
    index.set(clusterId, timestamps);
  }
  return index;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

export function filterLowQualityDecisions(records: readonly DecisionRecord[]): DecisionRecord[] {
  return records.filter((record) => (record.qualityScore ?? 0) < 0.5);
}

export function filterUnverifiedDecisions(records: readonly DecisionRecord[]): DecisionRecord[] {
  return records.filter(
    (record) => record.outcome.result === "unknown" || record.outcome.result === "pending"
  );
}

export interface ScoringReport {
  scores: Record<string, number>;
  total: number;
}

export function scoreAllDecisionsEffect(
  options: { projectRoot?: string; failurePath?: string } = {}
): Effect.Effect<ScoringReport, DecisionScoringError> {
  return Effect.tryPromise({
    try: async () => {
      const decisions = await readDecisions(options.projectRoot);
      const scores = await scoreDecisions(decisions, { failurePath: options.failurePath });
      return {
        scores: Object.fromEntries(scores),
        total: decisions.length,
      };
    },
    catch: (error) =>
      new DecisionScoringError({
        message: error instanceof Error ? error.message : Bun.inspect(error),
        failurePath: options.failurePath,
      }),
  });
}
