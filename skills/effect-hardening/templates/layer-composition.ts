/**
 * Module 4 — Layer composition (reference template).
 * Exemplar in repo: src/lib/effect/decision-services.ts, src/lib/effect/cli-runtime.ts
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentServiceLive, AgentServiceTag, AgentServiceTest, HerdrClient } from "./service.ts";

// ── Config tag ──

export interface ConfigService {
  readonly auditPath: string;
  readonly webhookUrl: string | null;
}

export class ConfigServiceTag extends Context.Tag("ConfigService")<
  ConfigServiceTag,
  ConfigService
>() {}

export const ConfigServiceLive = Layer.succeed(ConfigServiceTag, {
  auditPath: ".kimi/var/audit.jsonl",
  webhookUrl: null,
});

export const ConfigServiceTest = Layer.succeed(ConfigServiceTag, {
  auditPath: ":memory:",
  webhookUrl: null,
});

// ── Audit log layer ──

export class AuditLog extends Context.Tag("AuditLog")<
  AuditLog,
  { readonly append: (entry: unknown) => Effect.Effect<void> }
>() {}

export const AuditLogLive = Layer.effect(
  AuditLog,
  Effect.gen(function* () {
    const config = yield* ConfigServiceTag;
    return AuditLog.of({
      append: () =>
        Effect.sync(() => {
          // write to config.auditPath
        }),
    });
  })
);

export const AuditLogTest = Layer.succeed(AuditLog, {
  append: () => Effect.void,
});

// ── Herdr client stubs ──

const HerdrClientLive = Layer.succeed(HerdrClient, {
  paneGet: () => Effect.succeed(null),
  paneReportMetadata: () => Effect.void,
  watchEvents: () => Stream.empty,
});

const HerdrClientTest = HerdrClientLive;

// ── Application service ──

export class OrchestratorService extends Context.Tag("OrchestratorService")<
  OrchestratorService,
  { readonly startDaemon: () => Effect.Effect<void, never> }
>() {}

const OrchestratorServiceLive = Layer.succeed(OrchestratorService, {
  startDaemon: () => Effect.void,
});

// ── Production stack ──

export const OrchestratorLive = Layer.mergeAll(
  HerdrClientLive,
  AuditLogLive,
  OrchestratorServiceLive
).pipe(Layer.provide(AgentServiceLive), Layer.provide(ConfigServiceLive));

// ── Test stack (same shape) ──

export const OrchestratorTest = Layer.mergeAll(
  HerdrClientTest,
  AuditLogTest,
  OrchestratorServiceLive
).pipe(Layer.provide(AgentServiceTest), Layer.provide(ConfigServiceTest));

// ── Program entry ──

export const main = Effect.gen(function* () {
  const orchestrator = yield* OrchestratorService;
  yield* orchestrator.startDaemon();
}).pipe(
  Effect.provide(OrchestratorLive),
  Effect.tapError((error) =>
    Effect.sync(() => {
      console.error(`[fatal] ${(error as { _tag: string })._tag}:`, error);
    })
  ),
  Effect.exit
);
