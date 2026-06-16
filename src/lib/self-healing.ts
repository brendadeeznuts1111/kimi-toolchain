/**
 * Self-healing integration — records decisions before/after heal actions.
 */

import { Effect } from "effect";
import {
  logDecision,
  suggestDecisions,
  updateDecisionOutcome,
  type Decision,
} from "./decision-ledger.ts";
import { DecisionLogger, DecisionQuery, DecisionLayer } from "./effect/decision-services.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { clusterFailureLedgerEffect, loadCachedClusters } from "./error-clustering.ts";

export interface HealPlanAction {
  id: string;
  playbookId: string;
  description: string;
  safeToAutoApply: boolean;
  clusterId?: string;
  clusterConfidence?: number;
  errorId?: string;
}

export interface HealPlan {
  generatedAt: string;
  traceId: string;
  actions: HealPlanAction[];
  skippedDecisionIds: string[];
}

export interface HealApplyInput {
  actionId: string;
  playbookId: string;
  dryRun?: boolean;
  clusterId?: string;
  clusterConfidence?: number;
  errorId?: string;
  traceId?: string;
  execute?: () => Promise<{ success: boolean; detail: string }>;
}

export interface HealApplyResult {
  decision: Decision;
  applied: boolean;
  success: boolean;
  detail: string;
}

export function buildHealPlanEffect(
  options: {
    projectRoot?: string;
    traceId?: string;
  } = {}
): Effect.Effect<HealPlan, never> {
  return Effect.gen(function* () {
    const trace = ensureProcessTrace();
    const traceId = options.traceId ?? trace.traceId;
    const suggestions = yield* Effect.tryPromise({
      try: () => suggestDecisions({ projectRoot: options.projectRoot, limit: 10 }),
      catch: () => [] as Awaited<ReturnType<typeof suggestDecisions>>,
    }).pipe(
      Effect.catchAll(() => Effect.succeed([] as Awaited<ReturnType<typeof suggestDecisions>>))
    );
    const clusterReport = yield* clusterFailureLedgerEffect({ persist: false });
    const cached = yield* Effect.tryPromise({
      try: () => loadCachedClusters(),
      catch: () => null as Awaited<ReturnType<typeof loadCachedClusters>>,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));

    const failedDecisionIds = (yield* Effect.tryPromise({
      try: () => suggestDecisions({ projectRoot: options.projectRoot, limit: 50 }),
      catch: () => [] as Awaited<ReturnType<typeof suggestDecisions>>,
    }).pipe(
      Effect.catchAll(() => Effect.succeed([] as Awaited<ReturnType<typeof suggestDecisions>>))
    ))
      .filter((item) => item.qualityScore < 0.35)
      .map((item) => item.decisionId);

    const actions: HealPlanAction[] = clusterReport.clusters
      .filter((cluster) => cluster.hasPlaybook)
      .slice(0, 5)
      .map((cluster) => ({
        id: `heal-${cluster.clusterId}`,
        playbookId: cluster.playbookId ?? cluster.topTaxonomy,
        description: cluster.suggestedFix ?? cluster.autoFix ?? `Heal cluster ${cluster.clusterId}`,
        safeToAutoApply:
          !!cluster.autoFix?.includes("sync") || cluster.topTaxonomy === "format_check_failure",
        clusterId: cluster.clusterId,
        clusterConfidence: cluster.confidence,
        errorId: cluster.representativeError.errorId,
      }));

    if (actions.length === 0 && suggestions.length > 0) {
      for (const suggestion of suggestions.slice(0, 3)) {
        actions.push({
          id: `replay-${suggestion.decisionId}`,
          playbookId: suggestion.playbookId ?? suggestion.action,
          description: suggestion.summary,
          safeToAutoApply: false,
          clusterId: suggestion.clusterId,
        });
      }
    }

    void cached;

    return {
      generatedAt: new Date().toISOString(),
      traceId,
      actions,
      skippedDecisionIds: failedDecisionIds,
    };
  });
}

export async function applyHealAction(input: HealApplyInput): Promise<HealApplyResult> {
  const trace = ensureProcessTrace();
  const traceId = input.traceId ?? trace.traceId;

  const prior = await suggestDecisions({
    clusterId: input.clusterId,
    limit: 20,
  });
  const lowQualityReplay = prior.find(
    (item) => item.playbookId === input.playbookId && item.qualityScore < 0.35
  );

  const decision = await logDecision({
    action: "heal",
    trigger: {
      traceId,
      clusterId: input.clusterId,
      errorId: input.errorId,
    },
    metadata: {
      actionId: input.actionId,
      playbookId: input.playbookId,
      dryRun: !!input.dryRun,
      skippedDueToLowQuality: !!lowQualityReplay,
      clusterCount: prior.length,
    },
    outcome: input.dryRun || lowQualityReplay ? { result: "skipped" } : { result: "pending" },
  });

  if (input.dryRun) {
    return {
      decision,
      applied: false,
      success: true,
      detail: "Dry-run — decision logged, no mutation applied",
    };
  }

  if (lowQualityReplay) {
    await updateDecisionOutcome(decision.decisionId, {
      result: "skipped",
      verifiedAt: new Date().toISOString(),
      proof: {
        type: "manual",
        detail: `Skipped replay — prior decision ${lowQualityReplay.decisionId} scored ${lowQualityReplay.qualityScore}`,
      },
    });
    return {
      decision,
      applied: false,
      success: false,
      detail: `Skipped — prior low-quality decision ${lowQualityReplay.decisionId}`,
    };
  }

  let success = true;
  let detail = "Heal marked success (no executor provided)";
  if (input.execute) {
    const result = await input.execute();
    success = result.success;
    detail = result.detail;
  }

  const updated = await updateDecisionOutcome(decision.decisionId, {
    result: success ? "success" : "failure",
    verifiedAt: new Date().toISOString(),
    proof: success
      ? { type: "health-probe", detail }
      : { type: "manual", detail: `Heal failed: ${detail}` },
  });

  return {
    decision: updated ?? decision,
    applied: true,
    success,
    detail,
  };
}

export function applyHealActionEffect(
  input: HealApplyInput
): Effect.Effect<HealApplyResult, never> {
  return Effect.tryPromise({
    try: () => applyHealAction(input),
    catch: () => "heal-apply-failed",
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => ({
        decision: {
          schemaVersion: 2 as const,
          decisionId: "dec-fallback",
          timestamp: new Date().toISOString(),
          actor: "kimi" as const,
          action: "heal" as const,
          trigger: { traceId: input.traceId ?? "unknown" },
          rationale: {
            summary: "Heal failed",
            fullReasoning: "applyHealAction failed",
            evidence: [],
          },
          alternatives: [],
          outcome: { result: "failure" as const },
        },
        applied: false,
        success: false,
        detail: "Heal apply failed",
      }))
    )
  );
}

export function healWithDecisionLayer(
  input: HealApplyInput
): Effect.Effect<HealApplyResult, never> {
  return Effect.gen(function* () {
    const logger = yield* DecisionLogger;
    const query = yield* DecisionQuery;
    const traceId = input.traceId ?? ensureProcessTrace().traceId;

    const prior = yield* query.suggest({ clusterId: input.clusterId, limit: 20 });
    const lowQuality = prior.find(
      (item) => item.playbookId === input.playbookId && item.qualityScore < 0.35
    );

    const decision = yield* logger.log({
      action: "heal",
      trigger: { traceId, clusterId: input.clusterId, errorId: input.errorId },
      metadata: { actionId: input.actionId, playbookId: input.playbookId, dryRun: !!input.dryRun },
      outcome: input.dryRun || lowQuality ? { result: "skipped" } : { result: "pending" },
    });

    if (input.dryRun || lowQuality) {
      return {
        decision,
        applied: false,
        success: !lowQuality,
        detail: lowQuality ? `Skipped low-quality prior ${lowQuality.decisionId}` : "Dry-run only",
      };
    }

    let success = true;
    let detail = "Heal success";
    if (input.execute) {
      const result = yield* Effect.tryPromise({
        try: () => input.execute!(),
        catch: () => "execute-failed",
      }).pipe(Effect.catchAll(() => Effect.succeed({ success: false, detail: "execute failed" })));
      success = result.success;
      detail = result.detail;
    }

    const updated = yield* logger.updateOutcome(decision.decisionId, {
      result: success ? "success" : "failure",
      verifiedAt: new Date().toISOString(),
      proof: { type: success ? "health-probe" : "manual", detail },
    });

    return {
      decision: updated ?? decision,
      applied: true,
      success,
      detail,
    };
  }).pipe(Effect.provide(DecisionLayer));
}

/** @deprecated Use applyHealAction — kept for compat */
export { applyHealAction as recordHealWithDecision };
