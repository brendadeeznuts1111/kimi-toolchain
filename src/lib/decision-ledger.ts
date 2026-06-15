/**
 * Append-only decision ledger for `kimi-decision` and `kimi-why`.
 */

import { Context, Data, Effect, Layer } from "effect";
import { decisionLedgerPath } from "./paths.ts";
import { sha256String } from "./utils.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { buildTraceGraph, type TraceGraph } from "./trace-ledger.ts";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import {
  buildDecisionRationale,
  buildDecisionRationaleEffect,
  type RationaleBuildContext,
} from "./decision-rationale.ts";

export type { RationaleBuildContext } from "./decision-rationale.ts";
export { buildDecisionRationale, buildDecisionRationaleEffect } from "./decision-rationale.ts";

export type DecisionSchemaVersion = 1 | 2;
export type DecisionActor = "kimi" | "user" | "ci" | (string & {});
export type DecisionOutcome = "success" | "failure" | "unknown" | (string & {});
export type AlternativeFeasibility = "low" | "medium" | "high";

export interface DecisionEvidence {
  type: "traceStep" | "error" | "contractDiff" | "cluster" | "playbook" | "capability";
  traceId?: string;
  stepIndex?: number;
  errorId?: string;
  oldHash?: string;
  newHash?: string;
  clusterId?: string;
  playbookTitle?: string;
  contractFile?: string;
  capabilityItem?: string;
  detail?: string;
}

export interface DecisionRationaleBlock {
  summary: string;
  fullReasoning: string;
  evidence: DecisionEvidence[];
}

export interface DecisionTriggerContext {
  summary: string;
  traceId?: string;
  clusterId?: string;
  contractFile?: string;
  hookName?: string;
  capabilityItem?: string;
}

export interface DecisionAlternativeOption {
  action: string;
  feasibility: AlternativeFeasibility;
  reason?: string;
}

export interface DecisionOutcomeProof {
  type: string;
  detail?: string;
}

export interface DecisionOutcomeBlock {
  result: DecisionOutcome;
  verifiedAt?: string;
  proof?: DecisionOutcomeProof;
}

export interface DecisionRecord {
  schemaVersion: DecisionSchemaVersion;
  decisionId: string;
  id: string;
  key: string;
  timestamp: string;
  actor: DecisionActor;
  action: string;
  trigger: DecisionTriggerContext;
  clusterId?: string;
  rationale: DecisionRationaleBlock;
  alternatives: DecisionAlternativeOption[];
  outcome: DecisionOutcomeBlock;
  traceId?: string;
  parentTraceId?: string;
  parentDecisionId?: string;
  childDecisionIds: string[];
  capabilitySnapshotId?: string;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
  /** Legacy alias for rationale.fullReasoning. */
  reasoning: string;
  /** Legacy alias for alternatives[].action. */
  alternativesConsidered: string[];
}

export interface DecisionInput {
  decisionId?: string;
  key: string;
  actor?: DecisionActor;
  action: string;
  trigger?: string;
  triggerContext?: Partial<DecisionTriggerContext>;
  clusterId?: string;
  rationale?: string;
  reasoning?: string;
  rationaleContext?: RationaleBuildContext;
  rationaleBlock?: DecisionRationaleBlock;
  alternativesConsidered?: string[];
  alternatives?: string[];
  alternativeOptions?: DecisionAlternativeOption[];
  outcome?: DecisionOutcome | string;
  outcomeDetail?: DecisionOutcomeBlock;
  traceId?: string;
  parentTraceId?: string;
  parentDecisionId?: string;
  capabilitySnapshotId?: string;
  qualityScore?: number;
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
    readonly buildRationale: (
      context: RationaleBuildContext
    ) => Effect.Effect<DecisionRationaleBlock>;
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
    buildRationale: (context: RationaleBuildContext) => buildDecisionRationaleEffect(context),
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

export function decisionTriggerSummary(record: DecisionRecord): string {
  return record.trigger.summary;
}

export function decisionRationaleSummary(record: DecisionRecord): string {
  return record.rationale.summary;
}

export function decisionRationaleText(record: DecisionRecord): string {
  return record.rationale.fullReasoning;
}

export function decisionOutcomeResult(record: DecisionRecord): string {
  return record.outcome.result;
}

export function decisionAlternativeActions(record: DecisionRecord): string[] {
  return record.alternatives.map((option) => option.action);
}

export function previewDecisionId(
  input: Pick<DecisionInput, "key" | "action" | "trigger" | "triggerContext">
): string {
  const triggerSummary = input.trigger ?? input.triggerContext?.summary ?? "";
  return `decision-${sha256String(JSON.stringify({ key: input.key, action: input.action, trigger: triggerSummary })).slice(0, 16)}`;
}

export function createDecisionRecord(input: DecisionInput): DecisionRecord {
  const timestamp = new Date().toISOString();
  const trace = ensureProcessTrace();
  const trigger = resolveTrigger(input, trace.traceId);
  const rationale = resolveRationale(input);
  const alternatives = resolveAlternatives(input);
  const outcome = resolveOutcome(input);
  const clusterId = input.clusterId ?? trigger.clusterId;
  const body = {
    key: input.key,
    actor: input.actor ?? "kimi",
    action: input.action,
    trigger: trigger.summary,
    clusterId,
    rationale: rationale.summary,
    outcome: outcome.result,
    timestamp,
  };
  const decisionId =
    input.decisionId ?? `decision-${sha256String(JSON.stringify(body)).slice(0, 16)}`;
  return withLegacyAliases({
    schemaVersion: 2,
    decisionId,
    id: decisionId,
    key: input.key,
    timestamp,
    actor: input.actor ?? "kimi",
    action: input.action,
    trigger,
    clusterId,
    rationale,
    alternatives,
    outcome,
    traceId: input.traceId ?? trigger.traceId ?? trace.traceId,
    parentTraceId: input.parentTraceId ?? trace.parentTraceId,
    parentDecisionId: input.parentDecisionId,
    childDecisionIds: [],
    capabilitySnapshotId: input.capabilitySnapshotId,
    qualityScore: input.qualityScore,
    metadata: input.metadata,
  });
}

export async function recordDecision(
  input: DecisionInput,
  path: string = decisionLedgerPath()
): Promise<DecisionRecord> {
  const record = createDecisionRecord(input);
  await appendNdjsonRecord(path, serializeDecisionRecord(record));
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
    if (filters.outcome && record.outcome.result !== filters.outcome) return false;
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

function resolveTrigger(input: DecisionInput, fallbackTraceId: string): DecisionTriggerContext {
  const summary = input.triggerContext?.summary ?? input.trigger ?? "";
  if (!summary) {
    throw new Error("DecisionInput requires trigger or triggerContext.summary");
  }
  return {
    summary,
    traceId: input.triggerContext?.traceId ?? input.traceId ?? fallbackTraceId,
    clusterId: input.triggerContext?.clusterId ?? input.clusterId,
    contractFile: input.triggerContext?.contractFile,
    hookName: input.triggerContext?.hookName,
    capabilityItem: input.triggerContext?.capabilityItem,
  };
}

function resolveRationale(input: DecisionInput): DecisionRationaleBlock {
  if (input.rationaleBlock) return input.rationaleBlock;
  if (input.rationaleContext) return buildDecisionRationale(input.rationaleContext);
  const text = input.rationale ?? input.reasoning ?? "";
  if (!text) {
    throw new Error(
      "DecisionInput requires rationale, reasoning, rationaleContext, or rationaleBlock"
    );
  }
  return {
    summary: firstSentence(text),
    fullReasoning: text,
    evidence: [],
  };
}

function resolveAlternatives(input: DecisionInput): DecisionAlternativeOption[] {
  if (input.alternativeOptions?.length) return input.alternativeOptions;
  const labels = input.alternativesConsidered ?? input.alternatives ?? [];
  return labels.map((action) => ({ action, feasibility: "medium" as const }));
}

function resolveOutcome(input: DecisionInput): DecisionOutcomeBlock {
  if (input.outcomeDetail) return input.outcomeDetail;
  const result = normalizeOutcomeResult(input.outcome);
  if (!result) {
    throw new Error("DecisionInput requires outcome or outcomeDetail");
  }
  return { result };
}

function normalizeOutcomeResult(value: DecisionInput["outcome"]): DecisionOutcome | undefined {
  if (!value) return undefined;
  if (value === "success" || value === "failure" || value === "unknown") return value;
  if (value.toLowerCase().includes("fail")) return "failure";
  if (value.toLowerCase().includes("success") || value.toLowerCase().includes("applied")) {
    return "success";
  }
  return "unknown";
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? trimmed).trim();
}

function withLegacyAliases(
  record: Omit<DecisionRecord, "reasoning" | "alternativesConsidered">
): DecisionRecord {
  return {
    ...record,
    reasoning: record.rationale.fullReasoning,
    alternativesConsidered: record.alternatives.map((option) => option.action),
  };
}

function serializeDecisionRecord(record: DecisionRecord): Record<string, unknown> {
  return {
    schemaVersion: record.schemaVersion,
    decisionId: record.decisionId,
    id: record.id,
    key: record.key,
    timestamp: record.timestamp,
    actor: record.actor,
    action: record.action,
    trigger: record.trigger,
    clusterId: record.clusterId,
    rationale: record.rationale,
    alternatives: record.alternatives,
    outcome: record.outcome,
    traceId: record.traceId,
    parentTraceId: record.parentTraceId,
    parentDecisionId: record.parentDecisionId,
    childDecisionIds: record.childDecisionIds,
    capabilitySnapshotId: record.capabilitySnapshotId,
    qualityScore: record.qualityScore,
    metadata: record.metadata,
    reasoning: record.reasoning,
    alternativesConsidered: record.alternativesConsidered,
  };
}

function matchesDecision(record: DecisionRecord, needle: string): boolean {
  return [
    record.decisionId,
    record.id,
    record.key,
    record.actor,
    record.action,
    record.trigger.summary,
    record.trigger.traceId,
    record.trigger.clusterId,
    record.clusterId,
    record.rationale.summary,
    record.rationale.fullReasoning,
    record.outcome.result,
    ...record.alternatives.map((option) => option.action),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

async function traceForDecision(record: DecisionRecord): Promise<TraceGraph | undefined> {
  const candidates = [record.trigger.traceId, record.trigger.summary, record.traceId].filter(
    (traceId): traceId is string => typeof traceId === "string" && traceId.length > 0
  );
  for (const traceId of candidates) {
    try {
      const graph = await buildTraceGraph(traceId);
      if (graph.found) return graph;
    } catch {
      // Trace lookup is best-effort for decision explanations.
    }
  }
  return undefined;
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

export function normalizeDecisionRecord(value: unknown): DecisionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) return null;

  const decisionId = stringValue(raw.decisionId) ?? stringValue(raw.id);
  const key = stringValue(raw.key) ?? decisionId;
  const action = stringValue(raw.action);
  const timestamp = stringValue(raw.timestamp);
  if (!decisionId || !key || !action || !timestamp) return null;

  if (raw.schemaVersion === 2) {
    return normalizeDecisionRecordV2(raw, decisionId, key, action, timestamp);
  }
  return normalizeDecisionRecordV1(raw, decisionId, key, action, timestamp);
}

function normalizeDecisionRecordV2(
  raw: Record<string, unknown>,
  decisionId: string,
  key: string,
  action: string,
  timestamp: string
): DecisionRecord | null {
  const trigger = parseTriggerContext(raw.trigger);
  const rationale = parseRationaleBlock(raw.rationale, raw.reasoning);
  const alternatives = parseAlternativeOptions(raw.alternatives, raw.alternativesConsidered);
  const outcome = parseOutcomeBlock(raw.outcome);
  if (!trigger || !rationale || !outcome) return null;

  return withLegacyAliases({
    schemaVersion: 2,
    decisionId,
    id: decisionId,
    key,
    timestamp,
    actor: stringValue(raw.actor) ?? "kimi",
    action,
    trigger,
    clusterId: stringValue(raw.clusterId) ?? trigger.clusterId,
    rationale,
    alternatives,
    outcome,
    traceId: stringValue(raw.traceId) ?? trigger.traceId,
    parentTraceId: stringValue(raw.parentTraceId),
    parentDecisionId: stringValue(raw.parentDecisionId),
    childDecisionIds: stringArray(raw.childDecisionIds) ?? [],
    capabilitySnapshotId: stringValue(raw.capabilitySnapshotId),
    qualityScore: numberValue(raw.qualityScore),
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
  });
}

function normalizeDecisionRecordV1(
  raw: Record<string, unknown>,
  decisionId: string,
  key: string,
  action: string,
  timestamp: string
): DecisionRecord | null {
  const triggerSummary = stringValue(raw.trigger);
  const rationaleText = stringValue(raw.rationale) ?? stringValue(raw.reasoning);
  const outcomeResult = normalizeOutcomeResult(stringValue(raw.outcome));
  if (!triggerSummary || !rationaleText || !outcomeResult) return null;

  const alternatives = (
    stringArray(raw.alternativesConsidered) ??
    stringArray(raw.alternatives) ??
    []
  ).map((actionLabel) => ({ action: actionLabel, feasibility: "medium" as const }));

  return withLegacyAliases({
    schemaVersion: 1,
    decisionId,
    id: decisionId,
    key,
    timestamp,
    actor: stringValue(raw.actor) ?? "kimi",
    action,
    trigger: {
      summary: triggerSummary,
      traceId: stringValue(raw.traceId),
      clusterId: stringValue(raw.clusterId),
    },
    clusterId: stringValue(raw.clusterId),
    rationale: {
      summary: firstSentence(rationaleText),
      fullReasoning: rationaleText,
      evidence: [],
    },
    alternatives,
    outcome: { result: outcomeResult },
    traceId: stringValue(raw.traceId),
    parentTraceId: stringValue(raw.parentTraceId),
    parentDecisionId: stringValue(raw.parentDecisionId),
    childDecisionIds: stringArray(raw.childDecisionIds) ?? [],
    capabilitySnapshotId: stringValue(raw.capabilitySnapshotId),
    qualityScore: numberValue(raw.qualityScore),
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
  });
}

function parseTriggerContext(value: unknown): DecisionTriggerContext | null {
  if (typeof value === "string" && value.length > 0) {
    return { summary: value };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const summary = stringValue(raw.summary);
  if (!summary) return null;
  return {
    summary,
    traceId: stringValue(raw.traceId),
    clusterId: stringValue(raw.clusterId),
    contractFile: stringValue(raw.contractFile),
    hookName: stringValue(raw.hookName),
    capabilityItem: stringValue(raw.capabilityItem),
  };
}

function parseRationaleBlock(
  value: unknown,
  legacyReasoning: unknown
): DecisionRationaleBlock | null {
  if (typeof value === "string" && value.length > 0) {
    return { summary: firstSentence(value), fullReasoning: value, evidence: [] };
  }
  if (!value || typeof value !== "object") {
    const fallback = stringValue(legacyReasoning);
    return fallback
      ? { summary: firstSentence(fallback), fullReasoning: fallback, evidence: [] }
      : null;
  }
  const raw = value as Record<string, unknown>;
  const summary = stringValue(raw.summary);
  const fullReasoning = stringValue(raw.fullReasoning) ?? summary;
  if (!summary || !fullReasoning) return null;
  return {
    summary,
    fullReasoning,
    evidence: parseEvidenceArray(raw.evidence),
  };
}

function parseAlternativeOptions(value: unknown, legacy: unknown): DecisionAlternativeOption[] {
  if (Array.isArray(value)) {
    const parsed = value
      .map(parseAlternativeOption)
      .filter((option): option is DecisionAlternativeOption => !!option);
    if (parsed.length > 0) return parsed;
  }
  return (stringArray(legacy) ?? []).map((action) => ({ action, feasibility: "medium" as const }));
}

function parseAlternativeOption(value: unknown): DecisionAlternativeOption | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const action = stringValue(raw.action);
  if (!action) return null;
  const feasibility = parseFeasibility(raw.feasibility);
  return {
    action,
    feasibility,
    reason: stringValue(raw.reason),
  };
}

function parseFeasibility(value: unknown): AlternativeFeasibility {
  if (value === "low" || value === "high") return value;
  return "medium";
}

function parseOutcomeBlock(value: unknown): DecisionOutcomeBlock | null {
  if (typeof value === "string" && value.length > 0) {
    const result = normalizeOutcomeResult(value);
    return result ? { result } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const result = normalizeOutcomeResult(stringValue(raw.result));
  if (!result) return null;
  const proofRaw = raw.proof;
  const proof =
    proofRaw && typeof proofRaw === "object"
      ? {
          type: stringValue((proofRaw as Record<string, unknown>).type) ?? "unknown",
          detail: stringValue((proofRaw as Record<string, unknown>).detail),
        }
      : undefined;
  return {
    result,
    verifiedAt: stringValue(raw.verifiedAt),
    proof,
  };
}

function parseEvidenceArray(value: unknown): DecisionEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: DecisionEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = stringValue(raw.type);
    if (
      type !== "traceStep" &&
      type !== "error" &&
      type !== "contractDiff" &&
      type !== "cluster" &&
      type !== "playbook" &&
      type !== "capability"
    ) {
      continue;
    }
    evidence.push({
      type,
      traceId: stringValue(raw.traceId),
      stepIndex: numberValue(raw.stepIndex),
      errorId: stringValue(raw.errorId),
      oldHash: stringValue(raw.oldHash),
      newHash: stringValue(raw.newHash),
      clusterId: stringValue(raw.clusterId),
      playbookTitle: stringValue(raw.playbookTitle),
      contractFile: stringValue(raw.contractFile),
      capabilityItem: stringValue(raw.capabilityItem),
      detail: stringValue(raw.detail),
    });
  }
  return evidence;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
