/**
 * Effect-native institutional memory services.
 */

import { Context, Effect, Layer } from "effect";
import {
  appendMemoryRecord,
  readMemoryRecords,
  type InstitutionalMemoryRecord,
  type MemoryRecordInput,
} from "../institutional-memory.ts";
import {
  reconstructDecisionChain,
  type DecisionChain,
  type DecisionChainInput,
} from "../decision-chain.ts";

export interface InstitutionalMemoryService {
  readonly append: (
    input: MemoryRecordInput,
    path?: string
  ) => Effect.Effect<InstitutionalMemoryRecord, never>;
  readonly read: (path?: string) => Effect.Effect<InstitutionalMemoryRecord[], never>;
  readonly reconstructChain: (input: DecisionChainInput) => Effect.Effect<DecisionChain, never>;
}

export class InstitutionalMemoryLive extends Context.Tag("InstitutionalMemoryLive")<
  InstitutionalMemoryLive,
  InstitutionalMemoryService
>() {}

export const InstitutionalMemoryServiceLive = Layer.succeed(InstitutionalMemoryLive, {
  append: (input, path) =>
    Effect.sync(() => appendMemoryRecord(input, path)).pipe(
      Effect.catchAll(() => Effect.succeed(buildMemoryRecordFallback(input)))
    ),
  read: (path) =>
    Effect.tryPromise({
      try: () => readMemoryRecords(path),
      catch: () => "read-memory-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed([]))),
  reconstructChain: (input) =>
    Effect.tryPromise({
      try: () => reconstructDecisionChain(input),
      catch: () => "reconstruct-failed",
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed({
          schemaVersion: 1 as const,
          query: { traceId: input.traceId, errorId: input.errorId },
          traceIds: input.traceId ? [input.traceId] : [],
          errorIds: input.errorId ? [input.errorId] : [],
          clusterIds: [],
          steps: [],
          narrative: "Chain reconstruction failed",
        })
      )
    ),
});

function buildMemoryRecordFallback(input: MemoryRecordInput): InstitutionalMemoryRecord {
  return appendMemoryRecord(input);
}
