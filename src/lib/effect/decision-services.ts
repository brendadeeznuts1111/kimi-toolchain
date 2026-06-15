/**
 * Effect-TS DecisionLogger / DecisionQuery / DecisionLayer.
 */

import { Context, Effect, Layer } from "effect";
import {
  buildDecisionGraph,
  buildWhyReport,
  logDecision,
  logDecisionEffect,
  readDecisions,
  suggestDecisions,
  updateDecisionOutcome,
  type Decision,
  type DecisionGraph,
  type DecisionInput,
  type DecisionOutcome,
  type DecisionSuggestion,
  type RationaleContext,
} from "../decision-ledger.ts";
import { scoreAllDecisionsEffect, scoreDecision, type ScoringReport } from "../decision-scoring.ts";
import { readFailureTraceRecords } from "../trace-ledger.ts";

export interface DecisionLoggerService {
  readonly log: (
    input: DecisionInput,
    options?: { projectRoot?: string; context?: RationaleContext }
  ) => Effect.Effect<Decision, never>;
  readonly updateOutcome: (
    decisionId: string,
    outcome: DecisionOutcome,
    options?: { projectRoot?: string; qualityScore?: number }
  ) => Effect.Effect<Decision | null, never>;
}

export interface DecisionQueryService {
  readonly list: (projectRoot?: string) => Effect.Effect<Decision[], never>;
  readonly graph: (traceId: string, projectRoot?: string) => Effect.Effect<DecisionGraph, never>;
  readonly why: (
    decisionId: string,
    projectRoot?: string
  ) => Effect.Effect<Awaited<ReturnType<typeof buildWhyReport>>, never>;
  readonly suggest: (input: {
    clusterId?: string;
    action?: DecisionInput["action"];
    projectRoot?: string;
    limit?: number;
  }) => Effect.Effect<DecisionSuggestion[], never>;
  readonly scoreAll: (projectRoot?: string) => Effect.Effect<ScoringReport, never>;
  readonly scoreOne: (
    decision: Decision,
    projectRoot?: string
  ) => Effect.Effect<ReturnType<typeof scoreDecision>, never>;
}

export class DecisionLogger extends Context.Tag("DecisionLogger")<
  DecisionLogger,
  DecisionLoggerService
>() {}

export class DecisionQuery extends Context.Tag("DecisionQuery")<
  DecisionQuery,
  DecisionQueryService
>() {}

const DecisionLoggerLive = Layer.succeed(DecisionLogger, {
  log: (input, options) => logDecisionEffect(input, options),
  updateOutcome: (decisionId, outcome, options) =>
    Effect.tryPromise({
      try: () => updateDecisionOutcome(decisionId, outcome, options),
      catch: () => "update-outcome-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed(null))),
});

const DecisionQueryLive = Layer.succeed(DecisionQuery, {
  list: (projectRoot) =>
    Effect.tryPromise({
      try: () => readDecisions(projectRoot),
      catch: () => "read-decisions-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed([]))),
  graph: (traceId, projectRoot) =>
    Effect.gen(function* () {
      const decisions = yield* Effect.tryPromise({
        try: () => readDecisions(projectRoot),
        catch: () => "read-decisions-failed",
      }).pipe(Effect.catchAll(() => Effect.succeed([] as Decision[])));
      return buildDecisionGraph(decisions, traceId);
    }),
  why: (decisionId, projectRoot) =>
    Effect.tryPromise({
      try: () => buildWhyReport(decisionId, projectRoot),
      catch: () => "why-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed(null))),
  suggest: (input) =>
    Effect.tryPromise({
      try: () => suggestDecisions(input),
      catch: () => "suggest-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed([]))),
  scoreAll: (projectRoot) => scoreAllDecisionsEffect({ projectRoot }),
  scoreOne: (decision, projectRoot) =>
    Effect.gen(function* () {
      const [all, failures] = yield* Effect.all(
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
      return scoreDecision(decision, all, failures);
    }),
});

/** Combined layer providing DecisionLogger + DecisionQuery. */
export const DecisionLayer = Layer.merge(DecisionLoggerLive, DecisionQueryLive);

export { logDecision, readDecisions, buildDecisionGraph, suggestDecisions };
