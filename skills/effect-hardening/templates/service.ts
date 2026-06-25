/**
 * Module 1 — Effect service scaffold (reference template).
 * Exemplar in repo: src/lib/effect/tool-runner-effect.ts
 */
import { Context, Data, Effect, Layer, Stream } from "effect";

// ── Domain types ──

export type AgentId = string & { readonly _brand: "AgentId" };
export const AgentId = (id: string): AgentId => id as AgentId;

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly agentId: AgentId;
  readonly reason: "not_found" | "unhealthy" | "timeout";
  readonly context?: unknown;
}> {}

// ── Dependency tag (infrastructure edge) ──

export interface HerdrClientService {
  readonly paneGet: (id: AgentId) => Effect.Effect<{ status: AgentStatus } | null, never>;
  readonly paneReportMetadata: (
    id: AgentId,
    meta: { agent_status?: AgentStatus }
  ) => Effect.Effect<void, AgentError>;
  readonly watchEvents: (opts: {
    subscriptions: Array<{ type: string; pane_id: AgentId }>;
  }) => Stream.Stream<{ payload: { status: AgentStatus } }, AgentError>;
}

export class HerdrClient extends Context.Tag("HerdrClient")<HerdrClient, HerdrClientService>() {}

// ── Service interface ──

export interface AgentService {
  readonly getStatus: (id: AgentId) => Effect.Effect<AgentStatus, AgentError>;
  readonly updateStatus: (id: AgentId, status: AgentStatus) => Effect.Effect<void, AgentError>;
  readonly watchStatus: (id: AgentId) => Stream.Stream<AgentStatus, AgentError>;
}

export class AgentServiceTag extends Context.Tag("AgentService")<AgentServiceTag, AgentService>() {}

// ── Live implementation ──

export const AgentServiceLive = Layer.effect(
  AgentServiceTag,
  Effect.gen(function* () {
    const herdr = yield* HerdrClient;

    return AgentServiceTag.of({
      getStatus: (id) =>
        Effect.gen(function* () {
          const result = yield* herdr.paneGet(id);
          if (!result) {
            return yield* Effect.fail(new AgentError({ agentId: id, reason: "not_found" }));
          }
          return result.status;
        }),

      updateStatus: (id, status) => herdr.paneReportMetadata(id, { agent_status: status }),

      watchStatus: (id) =>
        herdr
          .watchEvents({
            subscriptions: [{ type: "pane.agent_status_changed", pane_id: id }],
          })
          .pipe(Stream.map((ev) => ev.payload.status)),
    });
  })
);

// ── Test implementation ──

export const AgentServiceTest = Layer.succeed(AgentServiceTag, {
  getStatus: () => Effect.succeed("idle" as AgentStatus),
  updateStatus: () => Effect.void,
  watchStatus: () => Stream.empty,
});
