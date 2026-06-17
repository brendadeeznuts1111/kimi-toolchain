/**
 * Module 3 — Event stream wiring (reference template).
 * Exemplar in repo: src/lib/herdr-orchestrator-events.ts
 */
import { Context, Effect, Queue, Stream, pipe } from "effect";
import type { AgentId } from "./service.ts";

// ── Event types ──

export interface HandoffEvent {
  readonly _tag: "HandoffEvent";
  readonly timestamp: Date;
  readonly from: AgentId;
  readonly to: AgentId;
  readonly rule: string;
  readonly context: unknown;
}

// ── Event bus via Queue (lightweight; no node EventEmitter) ──

export class HandoffBus extends Context.Tag("HandoffBus")<
  HandoffBus,
  Queue.Queue<HandoffEvent>
>() {}

declare const AgentServiceTag: {
  readonly watchStatus: (id: AgentId) => Stream.Stream<string, unknown>;
};

declare const OrchestratorService: Context.Tag<
  "OrchestratorService",
  {
    readonly executeHandoff: (from: AgentId, to: AgentId) => Effect.Effect<void, unknown>;
  }
>;

declare const AuditLog: Context.Tag<
  "AuditLog",
  { readonly append: (entry: { type: string; event: HandoffEvent }) => Effect.Effect<void> }
>;

// ── Producer: agent status → handoff events ──

export const watchAgentStatus = (agentId: AgentId, target: AgentId) =>
  pipe(
    AgentServiceTag.watchStatus(agentId),
    Stream.tap((status) =>
      Effect.sync(() => {
        console.log(`[watch] ${agentId}: ${status}`);
      })
    ),
    Stream.filter((status) => status === "idle" || status === "done"),
    Stream.mapEffect((status) =>
      Effect.gen(function* () {
        const bus = yield* HandoffBus;
        yield* Queue.offer(bus, {
          _tag: "HandoffEvent",
          timestamp: new Date(),
          from: agentId,
          to: target,
          rule: "idle-handoff",
          context: { status },
        });
      })
    )
  );

// ── Consumer: handoff bus → orchestrator ──

export const handoffConsumer = pipe(
  HandoffBus,
  Effect.flatMap((bus) => Queue.take(bus)),
  Effect.flatMap((event) =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService;
      yield* orchestrator.executeHandoff(event.from, event.to);
      const audit = yield* AuditLog;
      yield* audit.append({ type: "handoff", event });
    })
  ),
  Effect.forever
);

// ── Composition ──

export const reactiveOrchestrator = (agentId: AgentId, target: AgentId) =>
  pipe(
    Effect.all([Stream.runDrain(watchAgentStatus(agentId, target)), handoffConsumer], {
      concurrency: "unbounded",
    }),
    Effect.scoped
  );
