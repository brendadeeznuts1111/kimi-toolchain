/**
 * Decision quality scoring — self-evaluating past toolchain decisions.
 */

import { Effect } from "effect";
import {
  readDecisions,
  resolveDecisionsPath,
  resolveDecisionsRoot,
  type Decision,
  type DecisionOutcomeResult,
} from "./decision-ledger.ts";
import { readFailureTraceRecords } from "./trace-ledger.ts";
import { rewriteNdjsonFile } from "./ndjson.ts";

const MS_DAY = 24 * 60 * 60 * 1000;
const RECURRENCE_WINDOW_MS = MS_DAY;

export interface ScoringInput {
  projectRoot?: string;
  now?: Date;
}

export interface DecisionScoreResult {
  decisionId: string;
  qualityScore: number;
  factors: string[];
}

export interface ScoringReport {
  scoredAt: string;
  total: number;
  results: DecisionScoreResult[];
  durationMs: number;
}

export function scoreDecision(
  decision: Decision,
  allDecisions: Decision[],
  failures: Array<{ clusterId?: string; timestamp?: string; traceId?: string }>,
  now: Date = new Date()
): DecisionScoreResult {
  const factors: string[] = [];
  let score = 0.5;

  const outcome = decision.outcome.result;
  if (outcome === "pending" || outcome === "unknown") {
    factors.push("outcome-not-verified");
    return { decisionId: decision.decisionId, qualityScore: 0.5, factors };
  }
  if (outcome === "skipped") {
    factors.push("skipped-action");
    return { decisionId: decision.decisionId, qualityScore: 0.6, factors };
  }
  if (outcome === "failure") {
    factors.push("explicit-failure");
    return { decisionId: decision.decisionId, qualityScore: 0.15, factors };
  }

  const decisionTime = new Date(decision.outcome.verifiedAt ?? decision.timestamp).getTime();
  const clusterId = decision.trigger.clusterId;

  const rollbacks = allDecisions.filter(
    (other) =>
      other.parentDecisionId === decision.decisionId &&
      (other.metadata?.rollback === true ||
        other.rationale.summary.toLowerCase().includes("rollback"))
  );
  if (rollbacks.length > 0) {
    factors.push(`rollback-within-chain:${rollbacks.length}`);
    score = Math.min(score, 0.25);
  }

  if (clusterId) {
    const recurrence = failures.filter((failure) => {
      if (failure.clusterId !== clusterId) return false;
      const ts = failure.timestamp ? new Date(failure.timestamp).getTime() : 0;
      return ts > decisionTime && ts - decisionTime <= RECURRENCE_WINDOW_MS;
    });
    if (recurrence.length > 0) {
      factors.push(`cluster-recurred-24h:${recurrence.length}`);
      score = 0.2;
    } else {
      const later = failures.filter((failure) => {
        if (failure.clusterId !== clusterId) return false;
        const ts = failure.timestamp ? new Date(failure.timestamp).getTime() : 0;
        return ts > decisionTime;
      });
      const holdMs = KIMI_DECISION_SCORE_WINDOW_DAYS * MS_DAY;
      if (later.length === 0 && now.getTime() - decisionTime >= holdMs) {
        factors.push("cluster-hold-7d");
        score = 1.0;
      } else if (later.length === 0) {
        factors.push("cluster-quiet-so-far");
        score = 0.85;
      } else {
        factors.push(`cluster-recurred-after-24h:${later.length}`);
        score = 0.55;
      }
    }
  } else if (decision.action === "capability-degrade") {
    const restored = allDecisions.some(
      (other) =>
        other.timestamp > decision.timestamp &&
        other.action === "config-change" &&
        other.trigger.capabilityItem === decision.trigger.capabilityItem &&
        other.outcome.result === "success"
    );
    score = restored ? 0.9 : 0.65;
    factors.push(restored ? "capability-restored" : "degradation-unverified");
  } else if (decision.action === "contract-sign") {
    score = decision.outcome.proof?.type === "drift-resolved" ? 0.95 : 0.8;
    factors.push("contract-signed");
  } else {
    score = outcome === "success" ? 0.75 : 0.4;
    factors.push(`outcome-${outcome}`);
  }

  if (decision.outcome.proof?.type === "health-probe") {
    score = Math.min(1, score + 0.05);
    factors.push("health-probe-proof");
  }

  return {
    decisionId: decision.decisionId,
    qualityScore: Math.round(score * 1000) / 1000,
    factors,
  };
}

export function scoreAllDecisions(input: ScoringInput = {}): Promise<ScoringReport> {
  return Effect.runPromise(scoreAllDecisionsEffect(input));
}

export function scoreAllDecisionsEffect(
  input: ScoringInput = {}
): Effect.Effect<ScoringReport, never> {
  return Effect.gen(function* () {
    const started = performance.now();
    const now = input.now ?? new Date();
    const projectRoot = input.projectRoot;

    const [decisions, failures] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => readDecisions(projectRoot),
          catch: () => "read-decisions-failed",
        }).pipe(Effect.catchAll(() => Effect.succeed([] as Decision[]))),
        Effect.tryPromise({
          try: () => readFailureTraceRecords(),
          catch: () => "read-failures-failed",
        }).pipe(Effect.catchAll(() => Effect.succeed([]))),
      ],
      { concurrency: 2 }
    );

    const results: DecisionScoreResult[] = [];
    let changed = false;
    for (const decision of decisions) {
      const scored = scoreDecision(decision, decisions, failures, now);
      results.push(scored);
      if (decision.qualityScore !== scored.qualityScore) {
        decision.qualityScore = scored.qualityScore;
        changed = true;
      }
    }

    if (changed) {
      const root =
        projectRoot ??
        (yield* Effect.tryPromise({
          try: () => resolveDecisionsRoot(),
          catch: () => "resolve-root-failed",
        }).pipe(Effect.catchAll(() => Effect.succeed(Bun.cwd))));
      yield* Effect.tryPromise({
        try: async () => rewriteNdjsonFile(await resolveDecisionsPath(root), decisions),
        catch: () => "rewrite-scores-failed",
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    return {
      scoredAt: now.toISOString(),
      total: results.length,
      results,
      durationMs: Math.round(performance.now() - started),
    };
  });
}

export function filterLowQualityDecisions(decisions: Decision[], threshold = 0.4): Decision[] {
  return decisions.filter((decision) => {
    const score = decision.qualityScore;
    if (score !== undefined) return score < threshold;
    return decision.outcome.result === "failure" || decision.outcome.result === "pending";
  });
}

export function filterUnverifiedDecisions(decisions: Decision[]): Decision[] {
  return decisions.filter(
    (decision) =>
      decision.outcome.result === "pending" ||
      decision.outcome.result === "unknown" ||
      decision.qualityScore === undefined
  );
}

export function mapOutcomeToScoreHint(result: DecisionOutcomeResult): number {
  switch (result) {
    case "success":
      return 0.75;
    case "failure":
      return 0.15;
    case "skipped":
      return 0.6;
    case "pending":
    case "unknown":
    default:
      return 0.5;
  }
}
