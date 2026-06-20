/**
 * Append-only causal trace ledger and graph reconstruction.
 */

import { makeDir } from "./bun-io.ts";
import { dirname } from "path";
import { failureLedgerPath, traceEventsPath } from "./paths.ts";
import { readNdjsonFile, appendNdjsonRecord } from "./ndjson.ts";

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
  traceId?: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  timestamp?: string;
  toolName?: string;
  output?: string;
  taxonomyId?: string;
  categoryId?: string;
  categoryName?: string;
  severity?: string;
  expected?: boolean;
  suggestion?: string;
  autoFix?: string;
  sessionId?: string;
  embedding?: string;
  context?: {
    stack?: string;
    inputs?: Record<string, unknown>;
    environment?: Record<string, string>;
  };
}

export interface TraceGraphNode {
  traceId: string;
  parentTraceId?: string;
  childTraceIds: string[];
  events: TraceEvent[];
  failures: FailureTraceRecord[];
  status: Exclude<TraceStatus, "started">;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

export interface TraceGraph {
  rootTraceId: string;
  requestedTraceId: string;
  nodes: TraceGraphNode[];
  rootCauseChain: string[];
  found: boolean;
}

export interface TraceGraphOptions {
  tracePath?: string;
  failurePath?: string;
}

export async function recordTraceEvent(
  event: TraceEvent,
  path: string = traceEventsPath()
): Promise<void> {
  makeDir(dirname(path), { recursive: true });
  await appendNdjsonRecord(path, event);
}

export function buildTraceEvent(input: Omit<TraceEvent, "schemaVersion">): TraceEvent {
  return { schemaVersion: 1, ...input };
}

export async function readTraceEvents(path: string = traceEventsPath()): Promise<TraceEvent[]> {
  const records = await readNdjsonFile<TraceEvent>(path);
  return records.filter((event): event is TraceEvent => isTraceEvent(event));
}

export async function readFailureTraceRecords(
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord[]> {
  const records = await readNdjsonFile<FailureTraceRecord>(path);
  return records
    .filter((record): record is FailureTraceRecord => !!record && typeof record === "object")
    .map((record, index) => {
      if (!record.errorId) record.errorId = deriveErrorId(record, index);
      return record;
    });
}

export function deriveErrorId(record: FailureTraceRecord, index: number): string {
  const body = `${record.timestamp ?? ""}|${record.toolName ?? ""}|${record.output ?? ""}|${index}`;
  return `error-${Bun.hash(body).toString(16).slice(0, 12)}`;
}

export async function buildTraceGraph(
  requestedTraceId: string,
  options: TraceGraphOptions = {}
): Promise<TraceGraph> {
  const [events, failures] = await Promise.all([
    readTraceEvents(options.tracePath),
    readFailureTraceRecords(options.failurePath),
  ]);
  const parentByTrace = new Map<string, string>();
  const traceIds = new Set<string>();

  for (const event of events) {
    traceIds.add(event.traceId);
    if (event.parentTraceId) {
      traceIds.add(event.parentTraceId);
      parentByTrace.set(event.traceId, event.parentTraceId);
    }
    for (const child of event.childTraceIds ?? []) {
      traceIds.add(child);
      parentByTrace.set(child, event.traceId);
    }
  }
  for (const failure of failures) {
    if (!failure.traceId) continue;
    traceIds.add(failure.traceId);
    if (failure.parentTraceId) {
      traceIds.add(failure.parentTraceId);
      parentByTrace.set(failure.traceId, failure.parentTraceId);
    }
    for (const child of failure.childTraceIds ?? []) {
      traceIds.add(child);
      parentByTrace.set(child, failure.traceId);
    }
  }

  if (!traceIds.has(requestedTraceId)) {
    return {
      rootTraceId: requestedTraceId,
      requestedTraceId,
      nodes: [],
      rootCauseChain: [],
      found: false,
    };
  }

  let rootTraceId = requestedTraceId;
  const seenParents = new Set<string>();
  while (parentByTrace.has(rootTraceId) && !seenParents.has(rootTraceId)) {
    seenParents.add(rootTraceId);
    rootTraceId = parentByTrace.get(rootTraceId)!;
  }

  const children = new Map<string, Set<string>>();
  for (const traceId of traceIds) children.set(traceId, new Set());
  for (const [child, parent] of parentByTrace.entries()) {
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent)!.add(child);
  }

  const reachable = new Set<string>();
  const visit = (traceId: string) => {
    if (reachable.has(traceId)) return;
    reachable.add(traceId);
    for (const child of children.get(traceId) ?? []) visit(child);
  };
  visit(rootTraceId);

  const nodes = [...reachable].map((traceId) =>
    buildNode(
      traceId,
      parentByTrace.get(traceId),
      [...(children.get(traceId) ?? [])].sort(),
      events.filter((event) => event.traceId === traceId),
      failures.filter((failure) => failure.traceId === traceId)
    )
  );

  nodes.sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));

  return {
    rootTraceId,
    requestedTraceId,
    nodes,
    rootCauseChain: buildRootCauseChain(rootTraceId, nodes),
    found: true,
  };
}

function buildNode(
  traceId: string,
  parentTraceId: string | undefined,
  childTraceIds: string[],
  events: TraceEvent[],
  failures: FailureTraceRecord[]
): TraceGraphNode {
  const timestamps = [
    ...events.flatMap((event) => [event.startedAt, event.endedAt].filter(Boolean) as string[]),
    ...(failures.map((failure) => failure.timestamp).filter(Boolean) as string[]),
  ].sort();
  const status =
    failures.length > 0 || events.some((event) => event.status === "error")
      ? "error"
      : events.some((event) => event.status === "interrupted")
        ? "interrupted"
        : "ok";
  const durations = events
    .map((event) => event.durationMs)
    .filter((duration): duration is number => typeof duration === "number");
  return {
    traceId,
    parentTraceId,
    childTraceIds,
    events,
    failures,
    status,
    startedAt: timestamps[0],
    endedAt: timestamps[timestamps.length - 1],
    durationMs: durations.length > 0 ? Math.max(...durations) : undefined,
  };
}

function buildRootCauseChain(rootTraceId: string, nodes: TraceGraphNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.traceId, node]));
  const chain: string[] = [];
  const subtreeHasError = (traceId: string): boolean => {
    const node = byId.get(traceId);
    if (!node) return false;
    return node.status === "error" || node.childTraceIds.some((child) => subtreeHasError(child));
  };
  const walk = (traceId: string): boolean => {
    const node = byId.get(traceId);
    if (!node) return false;
    const failingChildren = node.childTraceIds.filter((child) => subtreeHasError(child));
    if (node.status !== "error" && failingChildren.length === 0) return false;
    chain.push(traceId);
    for (const child of failingChildren) {
      if (walk(child)) return true;
    }
    return node.status === "error";
  };
  walk(rootTraceId);
  return chain;
}

export function renderTraceTree(graph: TraceGraph): string {
  if (!graph.found) return `trace ${graph.requestedTraceId} not found`;
  const byId = new Map(graph.nodes.map((node) => [node.traceId, node]));
  const lines: string[] = [];
  const walk = (traceId: string, prefix: string) => {
    const node = byId.get(traceId);
    if (!node) return;
    const tool = node.events[0]?.tool || node.failures[0]?.toolName || "unknown";
    const duration = node.durationMs === undefined ? "" : ` ${node.durationMs}ms`;
    const cause = node.failures[0]?.taxonomyId || node.failures[0]?.categoryId;
    lines.push(
      `${prefix}${node.status} ${tool} ${traceId}${duration}${cause ? ` [${cause}]` : ""}`
    );
    node.childTraceIds.forEach((child, index) => {
      const last = index === node.childTraceIds.length - 1;
      walk(child, `${prefix}${last ? "└─ " : "├─ "}`);
    });
  };
  walk(graph.rootTraceId, "");
  if (graph.rootCauseChain.length > 0) {
    lines.push(`root-cause-chain: ${graph.rootCauseChain.join(" -> ")}`);
  }
  return lines.join("\n");
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
