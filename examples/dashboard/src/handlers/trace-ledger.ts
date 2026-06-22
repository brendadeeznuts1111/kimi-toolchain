// ── Trace Ledger ────────────────────────────────────────────────────

import {
  readTraceEvents,
  readFailureTraceRecords,
  buildTraceGraph,
  renderTraceTree,
  type TraceEvent,
  type FailureTraceRecord,
} from "../../../../src/lib/trace-ledger.ts";
import { traceEventsPath, failureLedgerPath } from "../../../../src/lib/paths.ts";
import { jsonResponse } from "./shared.ts";

interface RecentEvent {
  traceId: string;
  tool: string;
  eventType: string;
  status: string;
  durationMs?: number;
  startedAt: string;
  section?: string;
  command?: string[];
  error?: string;
}

interface TraceStats {
  totalEvents: number;
  uniqueTraces: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  byTool: Record<string, number>;
  byStatus: Record<string, number>;
}

interface RecentFailure {
  traceId?: string;
  toolName?: string;
  taxonomyId?: string;
  severity?: string;
  timestamp?: string;
  errorId?: string;
  output?: string;
}

interface TraceSummary {
  traceId: string;
  eventCount: number;
  tool: string;
  status: string;
  startedAt: string;
  totalDurationMs: number;
  sections: string[];
  hasErrors: boolean;
  hasFailures: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx]!;
}

export async function apiTraceLedger(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filterTool = url.searchParams.get("tool");
  const filterStatus = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);

  const [allEvents, allFailures] = await Promise.all([
    readTraceEvents(traceEventsPath()),
    readFailureTraceRecords(failureLedgerPath()),
  ]);

  let events = allEvents;
  if (filterTool) events = events.filter((e) => e.tool === filterTool);
  if (filterStatus) events = events.filter((e) => e.status === filterStatus);

  const recentEvents: RecentEvent[] = events
    .slice(-limit)
    .reverse()
    .map((e: TraceEvent) => ({
      traceId: e.traceId,
      tool: e.tool,
      eventType: e.eventType,
      status: e.status,
      durationMs: e.durationMs,
      startedAt: e.startedAt,
      section: typeof e.metadata?.section === "string" ? e.metadata.section : undefined,
      command: e.command,
      error: e.error,
    }));

  const uniqueTraces = new Set(events.map((e) => e.traceId));
  const errorCount = events.filter((e) => e.status === "error").length;
  const durations = events
    .map((e) => e.durationMs)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const avgDurationMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const byTool: Record<string, number> = {};
  for (const e of events) {
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
  }

  const byStatus: Record<string, number> = {};
  for (const e of events) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  }

  const stats: TraceStats = {
    totalEvents: events.length,
    uniqueTraces: uniqueTraces.size,
    errorCount,
    errorRate: events.length > 0 ? Math.round((errorCount / events.length) * 1000) / 10 : 0,
    avgDurationMs: Math.round(avgDurationMs * 100) / 100,
    p95DurationMs: Math.round(percentile(durations, 0.95) * 100) / 100,
    maxDurationMs: durations.length > 0 ? durations[durations.length - 1]! : 0,
    byTool,
    byStatus,
  };

  const recentFailures: RecentFailure[] = allFailures
    .slice(-10)
    .reverse()
    .map((f: FailureTraceRecord) => ({
      traceId: f.traceId,
      toolName: f.toolName,
      taxonomyId: f.taxonomyId,
      severity: f.severity,
      timestamp: f.timestamp,
      errorId: f.errorId,
      output: f.output?.slice(0, 200),
    }));

  // Build trace summaries — group events by traceId
  const traceGroups = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const group = traceGroups.get(e.traceId);
    if (group) group.push(e);
    else traceGroups.set(e.traceId, [e]);
  }

  const failureTraceIds = new Set(allFailures.filter((f) => f.traceId).map((f) => f.traceId!));

  const traceSummaries: TraceSummary[] = [...traceGroups.entries()]
    .map(([traceId, evts]): TraceSummary => {
      const sorted = evts.sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));
      const totalDurationMs = evts.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
      const sections = evts
        .map((e) => (typeof e.metadata?.section === "string" ? e.metadata.section : undefined))
        .filter((s): s is string => !!s);
      const hasErrors = evts.some((e) => e.status === "error");
      return {
        traceId,
        eventCount: evts.length,
        tool: sorted[0]?.tool ?? "unknown",
        status: hasErrors ? "error" : evts.every((e) => e.status === "ok") ? "ok" : "warn",
        startedAt: sorted[0]?.startedAt ?? "",
        totalDurationMs: Math.round(totalDurationMs * 100) / 100,
        sections,
        hasErrors,
        hasFailures: failureTraceIds.has(traceId),
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);

  return jsonResponse({ recentEvents, stats, recentFailures, traceSummaries });
}

export async function apiTraceGraph(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const traceId = url.searchParams.get("traceId");

  if (!traceId) {
    return jsonResponse({ error: "Missing traceId query parameter" }, 400);
  }

  const graph = await buildTraceGraph(traceId, {
    tracePath: traceEventsPath(),
    failurePath: failureLedgerPath(),
  });

  if (!graph.found) {
    return jsonResponse({ found: false, traceId });
  }

  return jsonResponse({
    found: true,
    rootTraceId: graph.rootTraceId,
    requestedTraceId: graph.requestedTraceId,
    rootCauseChain: graph.rootCauseChain,
    tree: renderTraceTree(graph),
    nodes: graph.nodes,
  });
}
