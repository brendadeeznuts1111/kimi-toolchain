/**
 * Effect trace context for causal toolchain runs.
 */

import { Context, Layer } from "effect";

export const TRACE_ID_ENV = "KIMI_TRACE_ID";
export const PARENT_TRACE_ID_ENV = "KIMI_PARENT_TRACE_ID";
export const TRACE_STARTED_AT_ENV = "KIMI_TRACE_STARTED_AT";

export interface TraceRuntime {
  traceId: string;
  parentTraceId?: string;
  startedAt: string;
}

export class TraceContext extends Context.Tag("TraceContext")<TraceContext, TraceRuntime>() {}

export function createTraceId(): string {
  return crypto.randomUUID();
}

export function readTraceFromEnv(): TraceRuntime | null {
  const traceId = Bun.env[TRACE_ID_ENV];
  if (!traceId) return null;
  return {
    traceId,
    parentTraceId: Bun.env[PARENT_TRACE_ID_ENV] || undefined,
    startedAt: Bun.env[TRACE_STARTED_AT_ENV] || new Date().toISOString(),
  };
}

export function ensureProcessTrace(): TraceRuntime {
  const existing = readTraceFromEnv();
  if (existing) return existing;

  const trace: TraceRuntime = {
    traceId: createTraceId(),
    parentTraceId: Bun.env[PARENT_TRACE_ID_ENV] || undefined,
    startedAt: new Date().toISOString(),
  };
  Bun.env[TRACE_ID_ENV] = trace.traceId;
  Bun.env[TRACE_STARTED_AT_ENV] = trace.startedAt;
  if (trace.parentTraceId) Bun.env[PARENT_TRACE_ID_ENV] = trace.parentTraceId;
  return trace;
}

export function TraceContextLive(trace: TraceRuntime = ensureProcessTrace()) {
  return Layer.succeed(TraceContext, trace);
}

export function childTraceEnv(
  parentTraceId: string = ensureProcessTrace().traceId,
  traceId: string = createTraceId()
): Record<string, string> {
  return {
    [TRACE_ID_ENV]: traceId,
    [PARENT_TRACE_ID_ENV]: parentTraceId,
    [TRACE_STARTED_AT_ENV]: new Date().toISOString(),
  };
}

export function currentTraceEnv(): Record<string, string> {
  const trace = ensureProcessTrace();
  return {
    [TRACE_ID_ENV]: trace.traceId,
    ...(trace.parentTraceId ? { [PARENT_TRACE_ID_ENV]: trace.parentTraceId } : {}),
    [TRACE_STARTED_AT_ENV]: trace.startedAt,
  };
}
