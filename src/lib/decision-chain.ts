/**
 * Reconstruct full decision chains from institutional memory, traces, failures, and clusters.
 */

import { Effect } from "effect";
import { readDecisions, type Decision } from "./decision-ledger.ts";
import {
  filterMemoryByErrorId,
  filterMemoryByTraceId,
  readMemoryRecords,
  type InstitutionalMemoryRecord,
  type MemoryActionType,
} from "./institutional-memory.ts";
import { readClusterMetadata, type ClusterMetadataFile } from "./failure-ledger.ts";
import {
  readFailureTraceRecords,
  readTraceEvents,
  type FailureTraceRecord,
  type TraceEvent,
} from "./trace-ledger.ts";

export const DECISION_CHAIN_SCHEMA_VERSION = 1;

export type DecisionChainStepKind =
  | "error"
  | "trace"
  | "cluster"
  | "memory"
  | "decision"
  | "follow_up";

export interface DecisionChainStep {
  kind: DecisionChainStepKind;
  timestamp: string;
  summary: string;
  actionType?: MemoryActionType | string;
  outcome?: string;
  traceId?: string;
  errorId?: string;
  clusterId?: string;
  detail?: Record<string, unknown>;
}

export interface DecisionChain {
  schemaVersion: typeof DECISION_CHAIN_SCHEMA_VERSION;
  query: { traceId?: string; errorId?: string };
  traceIds: string[];
  errorIds: string[];
  clusterIds: string[];
  steps: DecisionChainStep[];
  narrative: string;
}

export interface DecisionChainInput {
  traceId?: string;
  errorId?: string;
  memoryPath?: string;
  failurePath?: string;
  tracePath?: string;
}

const ACTION_LABELS: Record<MemoryActionType, string> = {
  heal_attempt: "Heal attempt",
  heal_outcome: "Heal outcome",
  contract_drift_heal: "Contract drift heal",
  contract_update: "Contract update",
  hook_registration: "Hook registration",
  mcp_config_change: "MCP config change",
  cluster_assignment: "Cluster assignment",
  manual_triage: "Manual triage",
};

export function reconstructDecisionChainEffect(
  input: DecisionChainInput
): Effect.Effect<DecisionChain, never> {
  return Effect.tryPromise({
    try: () => reconstructDecisionChain(input),
    catch: () => "decision-chain-failed",
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed(
        emptyChain(input.traceId, input.errorId, "Unable to reconstruct decision chain")
      )
    )
  );
}

export async function reconstructDecisionChain(input: DecisionChainInput): Promise<DecisionChain> {
  const traceId = input.traceId?.trim();
  const errorId = input.errorId?.trim();
  if (!traceId && !errorId) {
    return emptyChain(undefined, undefined, "Provide traceId or errorId");
  }

  const [memory, failures, traces, decisions, clusters] = await Promise.all([
    readMemoryRecords(input.memoryPath),
    readFailureTraceRecords(input.failurePath),
    readTraceEvents(input.tracePath),
    readDecisions(),
    readClusterMetadata(),
  ]);

  const seedFailure = errorId
    ? failures.find((record) => record.errorId === errorId)
    : traceId
      ? failures.find((record) => record.traceId === traceId)
      : undefined;

  const resolvedTraceId = traceId ?? seedFailure?.traceId;
  const resolvedErrorId = errorId ?? seedFailure?.errorId;

  const relatedMemory = dedupeMemory([
    ...(resolvedTraceId ? filterMemoryByTraceId(memory, resolvedTraceId) : []),
    ...(resolvedErrorId ? filterMemoryByErrorId(memory, resolvedErrorId) : []),
  ]);

  const traceIds = collectTraceIds(resolvedTraceId, seedFailure, relatedMemory, traces, decisions);
  const errorIds = collectErrorIds(resolvedErrorId, seedFailure, relatedMemory, failures);
  const clusterIds = collectClusterIds(seedFailure, relatedMemory, clusters);

  const steps: DecisionChainStep[] = [];

  if (seedFailure) {
    steps.push(failureStep(seedFailure));
  }

  for (const event of traceStepsForIds(traces, traceIds)) {
    steps.push(traceStep(event));
  }

  for (const clusterId of clusterIds) {
    const clusterStep = clusterStepForId(clusterId, clusters, seedFailure, relatedMemory);
    if (clusterStep) steps.push(clusterStep);
  }

  for (const record of relatedMemory) {
    steps.push(memoryStep(record));
  }

  for (const decision of decisionsForTraceIds(decisions, traceIds)) {
    steps.push(decisionStep(decision));
  }

  steps.sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.summary.localeCompare(b.summary)
  );

  const narrative = buildNarrative(steps, { traceId: resolvedTraceId, errorId: resolvedErrorId });

  return {
    schemaVersion: DECISION_CHAIN_SCHEMA_VERSION,
    query: { traceId: resolvedTraceId, errorId: resolvedErrorId },
    traceIds,
    errorIds,
    clusterIds,
    steps,
    narrative,
  };
}

function emptyChain(
  traceId: string | undefined,
  errorId: string | undefined,
  message: string
): DecisionChain {
  return {
    schemaVersion: DECISION_CHAIN_SCHEMA_VERSION,
    query: { traceId, errorId },
    traceIds: traceId ? [traceId] : [],
    errorIds: errorId ? [errorId] : [],
    clusterIds: [],
    steps: [],
    narrative: message,
  };
}

function dedupeMemory(records: InstitutionalMemoryRecord[]): InstitutionalMemoryRecord[] {
  const seen = new Set<string>();
  const out: InstitutionalMemoryRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

function collectTraceIds(
  seedTraceId: string | undefined,
  failure: FailureTraceRecord | undefined,
  memory: InstitutionalMemoryRecord[],
  traces: TraceEvent[],
  decisions: Decision[]
): string[] {
  const ids = new Set<string>();
  if (seedTraceId) ids.add(seedTraceId);
  if (failure?.traceId) ids.add(failure.traceId);
  if (failure?.parentTraceId) ids.add(failure.parentTraceId);
  for (const record of memory) {
    ids.add(record.traceId);
    if (record.parentTraceId) ids.add(record.parentTraceId);
    for (const child of record.childTraceIds ?? []) ids.add(child);
  }
  for (const decision of decisions) {
    if (decision.trigger.traceId) ids.add(decision.trigger.traceId);
  }
  for (const event of traces) {
    if (ids.has(event.traceId)) {
      if (event.parentTraceId) ids.add(event.parentTraceId);
      for (const child of event.childTraceIds ?? []) ids.add(child);
    }
  }
  return [...ids].sort();
}

function collectErrorIds(
  seedErrorId: string | undefined,
  failure: FailureTraceRecord | undefined,
  memory: InstitutionalMemoryRecord[],
  failures: FailureTraceRecord[]
): string[] {
  const ids = new Set<string>();
  if (seedErrorId) ids.add(seedErrorId);
  if (failure?.errorId) ids.add(failure.errorId);
  for (const record of memory) {
    if (record.errorId) ids.add(record.errorId);
  }
  for (const item of failures) {
    if (item.traceId && failure?.traceId && item.traceId === failure.traceId && item.errorId) {
      ids.add(item.errorId);
    }
  }
  return [...ids].sort();
}

function collectClusterIds(
  failure: FailureTraceRecord | undefined,
  memory: InstitutionalMemoryRecord[],
  clusters: ClusterMetadataFile | null
): string[] {
  const ids = new Set<string>();
  if (failure?.clusterId) ids.add(failure.clusterId);
  for (const record of memory) {
    if (record.clusterId) ids.add(record.clusterId);
  }
  if (clusters) {
    for (const cluster of clusters.clusters) {
      if (cluster.representativeError.errorId === failure?.errorId) ids.add(cluster.clusterId);
      if (cluster.representativeError.traceId === failure?.traceId) ids.add(cluster.clusterId);
    }
  }
  return [...ids].sort();
}

function failureStep(record: FailureTraceRecord): DecisionChainStep {
  const preview = (record.output || "unknown failure").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    kind: "error",
    timestamp: record.timestamp || new Date(0).toISOString(),
    summary: `Failure: ${record.toolName || "tool"} — ${preview}`,
    traceId: record.traceId,
    errorId: record.errorId,
    clusterId: record.clusterId,
    detail: {
      taxonomyId: record.taxonomyId,
      severity: record.severity,
      suggestion: record.suggestion,
      autoFix: record.autoFix,
    },
  };
}

function traceStepsForIds(traces: TraceEvent[], traceIds: string[]): TraceEvent[] {
  const wanted = new Set(traceIds);
  return traces
    .filter((event) => wanted.has(event.traceId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function traceStep(event: TraceEvent): DecisionChainStep {
  const command = event.command?.join(" ");
  const summary = command ? `${event.tool}: ${command}` : event.tool;
  return {
    kind: "trace",
    timestamp: event.startedAt,
    summary: `Trace ${event.status}: ${summary}`,
    traceId: event.traceId,
    outcome: event.status,
    detail: {
      eventType: event.eventType,
      durationMs: event.durationMs,
      error: event.error,
      parentTraceId: event.parentTraceId,
    },
  };
}

function clusterStepForId(
  clusterId: string,
  clusters: ClusterMetadataFile | null,
  failure: FailureTraceRecord | undefined,
  memory: InstitutionalMemoryRecord[]
): DecisionChainStep | null {
  const fromMemory = memory.find(
    (record) => record.clusterId === clusterId && record.actionType === "cluster_assignment"
  );
  const meta = clusters?.clusters.find((cluster) => cluster.clusterId === clusterId);
  const timestamp =
    fromMemory?.timestamp ||
    meta?.representativeError.traceId ||
    failure?.timestamp ||
    new Date(0).toISOString();
  const confidence = fromMemory?.clusterConfidence ?? meta?.confidence;
  const taxonomy = meta?.topTaxonomy || failure?.taxonomyId || "unknown";
  return {
    kind: "cluster",
    timestamp,
    summary: `Cluster match: ${clusterId} (${taxonomy}, confidence ${confidence ?? "n/a"})`,
    clusterId,
    traceId: meta?.representativeError.traceId ?? failure?.traceId,
    errorId: meta?.representativeError.errorId ?? failure?.errorId,
    detail: {
      count: meta?.count,
      suggestedFix: meta?.suggestedFix,
      autoFix: meta?.autoFix,
      hasPlaybook: meta?.hasPlaybook,
    },
  };
}

function memoryStep(record: InstitutionalMemoryRecord): DecisionChainStep {
  const label = ACTION_LABELS[record.actionType] ?? record.actionType;
  return {
    kind: record.actionType.includes("outcome") ? "follow_up" : "memory",
    timestamp: record.timestamp,
    summary: `${label}: ${record.rationale}`,
    actionType: record.actionType,
    outcome: record.outcome,
    traceId: record.traceId,
    errorId: record.errorId,
    clusterId: record.clusterId,
    detail: {
      actor: record.actor,
      payloadSummary: record.payloadSummary,
      parentTraceId: record.parentTraceId,
      clusterConfidence: record.clusterConfidence,
      metadata: record.metadata,
    },
  };
}

function decisionsForTraceIds(decisions: Decision[], traceIds: string[]): Decision[] {
  const wanted = new Set(traceIds);
  return decisions.filter(
    (decision) => decision.trigger.traceId && wanted.has(decision.trigger.traceId)
  );
}

function decisionStep(record: Decision): DecisionChainStep {
  return {
    kind: "decision",
    timestamp: record.timestamp,
    summary: `Decision (${record.action}): ${record.rationale.summary}`,
    actionType: record.action,
    outcome: record.outcome.result,
    traceId: record.trigger.traceId,
    detail: {
      decisionId: record.decisionId,
      fullReasoning: record.rationale.fullReasoning,
      alternatives: record.alternatives,
      qualityScore: record.qualityScore,
      metadata: record.metadata,
    },
  };
}

function buildNarrative(
  steps: DecisionChainStep[],
  query: { traceId?: string; errorId?: string }
): string {
  if (steps.length === 0) {
    if (query.traceId) return `No institutional memory found for trace ${query.traceId}.`;
    if (query.errorId) return `No institutional memory found for error ${query.errorId}.`;
    return "No decision chain data available.";
  }

  const lines: string[] = [];
  const header = query.traceId
    ? `Decision chain for trace ${query.traceId}`
    : `Decision chain for error ${query.errorId}`;
  lines.push(header);
  lines.push("");

  for (const step of steps) {
    const stamp = step.timestamp.slice(0, 19).replace("T", " ");
    lines.push(`[${stamp}] ${step.summary}`);
    if (step.outcome && step.outcome !== step.summary) {
      lines.push(`  outcome: ${step.outcome}`);
    }
    if (step.clusterId) {
      lines.push(`  cluster: ${step.clusterId}`);
    }
    if (step.detail?.payloadSummary) {
      lines.push(`  changed: ${step.detail.payloadSummary}`);
    }
  }

  return lines.join("\n");
}

export function formatDecisionChainJson(chain: DecisionChain): string {
  return `${JSON.stringify(chain, null, 2)}\n`;
}

export function formatDecisionChainHuman(chain: DecisionChain): string {
  return `${chain.narrative}\n`;
}
