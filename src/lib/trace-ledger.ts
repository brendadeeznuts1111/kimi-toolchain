/**
 * Append-only causal trace ledger and graph reconstruction.
 */

import { appendText, makeDir, pathExists } from "./bun-io.ts";

import { dirname } from "path";
import { failureLedgerPath, traceEventsPath } from "./paths.ts";
import { safeParse } from "./utils.ts";

export type TraceEventType = "cli" | "subprocess" | "hook" | "mcp";
export type TraceStatus = "started" | "ok" | "error" | "interrupted";

export interface TraceEvent {
  schemaVersion: 1;
  traceId: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  eventType: TraceEventType;
  tool: string;
  command?: string[];
  cwd?: string;
  status: TraceStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface FailureTraceRecord {
  errorId?: string;
  clusterId?: string;
  embedding?: string;
  traceId?: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  timestamp?: string;
  toolName?: string;
  output?: string;
  taxonomyId?: string;
  categoryId?: string;
  severity?: string;
  expected?: boolean;
  suggestion?: string;
  autoFix?: string;
  healedPlaybookId?: string;
  context?: {
    stack?: string;
    inputs?: Record<string, unknown>;
    environment?: Record<string, string>;
  };
}

export function recordTraceEvent(event: TraceEvent, path: string = traceEventsPath()): void {
  makeDir(dirname(path), { recursive: true });
  appendText(path, `${JSON.stringify(event)}\n`);
}

export function buildTraceEvent(input: Omit<TraceEvent, "schemaVersion">): TraceEvent {
  return { schemaVersion: 1, ...input };
}

export async function readTraceEvents(path: string = traceEventsPath()): Promise<TraceEvent[]> {
  if (!pathExists(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParse<TraceEvent | null>(line, null))
    .filter((event): event is TraceEvent => isTraceEvent(event));
}

export async function readFailureTraceRecords(
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord[]> {
  if (!pathExists(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParse<FailureTraceRecord | null>(line, null))
    .filter((record): record is FailureTraceRecord => !!record && typeof record === "object");
}

function isTraceEvent(value: unknown): value is TraceEvent {
  return (
    !!value &&
    typeof value === "object" &&
    (value as TraceEvent).schemaVersion === 1 &&
    typeof (value as TraceEvent).traceId === "string" &&
    typeof (value as TraceEvent).eventType === "string"
  );
}
