/**
 * Append-only decision ledger for `kimi why`.
 */

import { Context, Data, Effect, Layer } from "effect";
import { decisionLedgerPath } from "./paths.ts";
import { sha256String } from "./utils.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { buildTraceGraph, type TraceGraph } from "./trace-ledger.ts";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";

export type DecisionActor = "kimi" | "user" | "ci" | (string & {});
export type DecisionOutcome = "success" | "failure" | "unknown" | (string & {});

export interface DecisionRecord {
  schemaVersion: 1;
  /** Canonical id. */
  decisionId: string;
  /** Legacy alias kept for existing `kimi-why` records and callers. */
  id: string;
  key: string;
  timestamp: string;
  actor: DecisionActor;
  action: string;
  trigger: string;
  clusterId?: string;
  /** Canonical explanation field. */
  rationale: string;
  /** Legacy alias kept for existing records and docs. */
  reasoning: string;
  alternativesConsidered: string[];
  /** Legacy alias kept for existing records and docs. */
  alternatives: string[];
  outcome: DecisionOutcome;
  traceId?: string;
  parentTraceId?: string;
  parentDecisionId?: string;
  childDecisionIds: string[];
  capabilitySnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionInput {
  decisionId?: string;
  key: string;
  actor?: DecisionActor;
  action: string;
  trigger: string;
  clusterId?: string;
  rationale?: string;
  reasoning?: string;
  alternativesConsidered?: string[];
  alternatives?: string[];
  outcome: DecisionOutcome;
  traceId?: string;
  parentTraceId?: string;
  parentDecisionId?: string;
  capabilitySnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionQueryFilters {
  limit?: number;
  action?: string;
  cluster?: string;
  since?: string;
  actor?: string;
  outcome?: string;
}

export interface DecisionExplanation {
  query: string;
  matches: DecisionRecord[];
  latest?: DecisionRecord;
  trace?: TraceGraph;
  rootCauseChain: string[];
  followUps: DecisionRecord[];
}

export interface DecisionLedgerOptions {
  path?: string;
}

export class DecisionLedgerReadError extends Data.TaggedError("DecisionLedgerReadError")<{
  path: string;
  message: string;
}> {}

export class DecisionLedgerWriteError extends Data.TaggedError("DecisionLedgerWriteError")<{
  path: string;
  message: string;
}> {}

export class DecisionLogger extends Context.Tag("DecisionLogger")<
  DecisionLogger,
  {
    readonly logDecision: (
      decision: DecisionInput
    ) => Effect.Effect<DecisionRecord, DecisionLedgerWriteError>;
    readonly recordAction: (
      decision: Omit<DecisionInput, "traceId" | "parentTraceId">
    ) => Effect.Effect<DecisionRecord, DecisionLedgerWriteError>;
    readonly list: (
      filters?: DecisionQueryFilters
    ) => Effect.Effect<DecisionRecord[], DecisionLedgerReadError>;
    readonly why: (query: string) => Effect.Effect<DecisionExplanation, DecisionLedgerReadError>;
  }
>() {}

export function DecisionLoggerLive(options: DecisionLedgerOptions = {}) {
  return Layer.succeed(DecisionLogger, makeDecisionLogger(options));
}

export function makeDecisionLogger(options: DecisionLedgerOptions = {}) {
  const path = options.path ?? decisionLedgerPath();
  return {
    logDecision: (decision: DecisionInput) =>
      Effect.tryPromise({
        try: () => recordDecision(decision, path),
        catch: (cause) =>
          new DecisionLedgerWriteError({
            path,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
    recordAction: (decision: Omit<DecisionInput, "traceId" | "parentTraceId">) =>
      Effect.tryPromise({
        try: () => recordDecision(decision, path),
        catch: (cause) =>
          new DecisionLedgerWriteError({
            path,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
    list: (filters: DecisionQueryFilters = {}) =>
      Effect.tryPromise({
        try: () => queryDecisionLedger(filters, path),
        catch: (cause) =>
          new DecisionLedgerReadError({
            path,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
    why: (query: string) =>
      Effect.tryPromise({
        try: () => explainDecision(query, path),
        catch: (cause) =>
          new DecisionLedgerReadError({
            path,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  };
}

export function previewDecisionId(
  input: Pick<DecisionInput, "key" | "action" | "trigger">
): string {
  return `decision-${sha256String(JSON.stringify(input)).slice(0, 16)}`;
}

export function createDecisionRecord(input: DecisionInput): DecisionRecord {
  const timestamp = new Date().toISOString();
  const trace = ensureProcessTrace();
  const rationale = input.rationale ?? input.reasoning ?? "";
  const alternatives = input.alternativesConsidered ?? input.alternatives ?? [];
  const body = {
    key: input.key,
    actor: input.actor ?? "kimi",
    action: input.action,
    trigger: input.trigger,
    clusterId: input.clusterId,
    rationale,
    outcome: input.outcome,
    timestamp,
  };
  const decisionId =
    input.decisionId ?? `decision-${sha256String(JSON.stringify(body)).slice(0, 16)}`;
  return {
    schemaVersion: 1,
    decisionId,
    id: decisionId,
    key: input.key,
    timestamp,
    actor: input.actor ?? "kimi",
    action: input.action,
    trigger: input.trigger,
    clusterId: input.clusterId,
    rationale,
    reasoning: rationale,
    alternativesConsidered: alternatives,
    alternatives,
    outcome: input.outcome,
    traceId: input.traceId ?? trace.traceId,
    parentTraceId: input.parentTraceId ?? trace.parentTraceId,
    parentDecisionId: input.parentDecisionId,
    childDecisionIds: [],
    capabilitySnapshotId: input.capabilitySnapshotId,
    metadata: input.metadata,
  };
}

export async function recordDecision(
  input: DecisionInput,
  path: string = decisionLedgerPath()
): Promise<DecisionRecord> {
  const record = createDecisionRecord(input);
  await appendNdjsonRecord(path, record);
  return record;
}

export async function readDecisionLedger(
  path: string = decisionLedgerPath()
): Promise<DecisionRecord[]> {
  const records = (await readNdjsonFile<unknown>(path))
    .map(normalizeDecisionRecord)
    .filter((record): record is DecisionRecord => !!record)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return withChildDecisionIds(records);
}

export async function queryDecisionLedger(
  filters: DecisionQueryFilters = {},
  path: string = decisionLedgerPath()
): Promise<DecisionRecord[]> {
  const since = filters.since ? Date.parse(filters.since) : NaN;
  const records = (await readDecisionLedger(path)).filter((record) => {
    if (filters.action && record.action !== filters.action) return false;
    if (filters.cluster && record.clusterId !== filters.cluster) return false;
    if (filters.actor && record.actor !== filters.actor) return false;
    if (filters.outcome && record.outcome !== filters.outcome) return false;
    if (Number.isFinite(since) && Date.parse(record.timestamp) < since) return false;
    return true;
  });
  const descending = records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return typeof filters.limit === "number" && filters.limit > 0
    ? descending.slice(0, filters.limit)
    : descending;
}

export async function explainDecision(
  query: string,
  path: string = decisionLedgerPath()
): Promise<DecisionExplanation> {
  const records = await readDecisionLedger(path);
  const needle = query.toLowerCase();
  const matches = records
    .filter((record) => matchesDecision(record, needle))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = matches[matches.length - 1];
  const trace = latest ? await traceForDecision(latest) : undefined;
  const followUps = latest
    ? records
        .filter((record) => record.parentDecisionId === latest.decisionId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];
  return {
    query,
    matches,
    latest,
    trace,
    rootCauseChain: trace?.rootCauseChain ?? [],
    followUps,
  };
}

function matchesDecision(record: DecisionRecord, needle: string): boolean {
  return [
    record.decisionId,
    record.id,
    record.key,
    record.actor,
    record.action,
    record.trigger,
    record.clusterId,
    record.rationale,
    record.outcome,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

async function traceForDecision(record: DecisionRecord): Promise<TraceGraph | undefined> {
  const traceId = record.trigger || record.traceId;
  if (!traceId) return undefined;
  try {
    const graph = await buildTraceGraph(traceId);
    return graph.found ? graph : undefined;
  } catch {
    return undefined;
  }
}

function withChildDecisionIds(records: DecisionRecord[]): DecisionRecord[] {
  const childIds = new Map<string, string[]>();
  for (const record of records) {
    if (!record.parentDecisionId) continue;
    const existing = childIds.get(record.parentDecisionId) ?? [];
    existing.push(record.decisionId);
    childIds.set(record.parentDecisionId, existing);
  }
  return records.map((record) => ({
    ...record,
    childDecisionIds: childIds.get(record.decisionId) ?? [],
  }));
}

function normalizeDecisionRecord(value: unknown): DecisionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return null;

  const decisionId = stringValue(raw.decisionId) ?? stringValue(raw.id);
  const key = stringValue(raw.key) ?? decisionId;
  const action = stringValue(raw.action);
  const trigger = stringValue(raw.trigger);
  const rationale = stringValue(raw.rationale) ?? stringValue(raw.reasoning);
  const outcome = stringValue(raw.outcome);
  const timestamp = stringValue(raw.timestamp);
  if (!decisionId || !key || !action || !trigger || !rationale || !outcome || !timestamp) {
    return null;
  }

  const alternatives =
    stringArray(raw.alternativesConsidered) ?? stringArray(raw.alternatives) ?? [];
  return {
    schemaVersion: 1,
    decisionId,
    id: decisionId,
    key,
    timestamp,
    actor: stringValue(raw.actor) ?? "kimi",
    action,
    trigger,
    clusterId: stringValue(raw.clusterId),
    rationale,
    reasoning: rationale,
    alternativesConsidered: alternatives,
    alternatives,
    outcome,
    traceId: stringValue(raw.traceId),
    parentTraceId: stringValue(raw.parentTraceId),
    parentDecisionId: stringValue(raw.parentDecisionId),
    childDecisionIds: stringArray(raw.childDecisionIds) ?? [],
    capabilitySnapshotId: stringValue(raw.capabilitySnapshotId),
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}
