/**
 * Append-only decision ledger for `kimi-decision` and `kimi-why`.
 */

import { Context, Data, Effect, Layer } from "effect";
import { decisionLedgerPath, decisionsNdjsonPath } from "./paths.ts";
import { resolveProjectRoot, sha256String } from "./utils.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { buildTraceGraph, type TraceGraph } from "./trace-ledger.ts";
import { appendNdjsonRecord, readNdjsonFile, rewriteNdjsonFile } from "./ndjson.ts";
import {
  buildDecisionRationale,
  buildDecisionRationaleEffect,
  type RationaleBuildContext,
} from "./decision-rationale.ts";

export type { RationaleBuildContext } from "./decision-rationale.ts";
export { buildDecisionRationale, buildDecisionRationaleEffect } from "./decision-rationale.ts";
export { buildDecisionGraph } from "./decision-graph.ts";

/** Backward-compatible aliases for legacy callers. */
export type Decision = DecisionRecord;
export type DecisionSuggestion = DecisionRecord;
export type RationaleContext = RationaleBuildContext;

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
  evidence?: DecisionEvidence[];
}

export interface DecisionTriggerContext {
  summary?: string;
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
  return record.trigger.summary ?? "";
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
  return withChildDecisionIds(applyQualityScoreUpdates(records));
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
  return value;
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
  const summary =
    stringValue(raw.summary) ??
    stringValue(raw.traceId) ??
    stringValue(raw.clusterId) ??
    "legacy trigger";
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

export interface DecisionSuggestionInput {
  clusterId?: string;
  action?: string;
  limit?: number;
}

export async function suggestDecisions(
  input: DecisionSuggestionInput,
  path: string = decisionLedgerPath()
): Promise<DecisionRecord[]> {
  const records = await readDecisionLedger(path);
  const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : 5;
  const actionNeedle = input.action?.trim().toLowerCase();

  return records
    .filter((record) => (record.qualityScore ?? 0) >= 0.7)
    .filter((record) => {
      if (input.clusterId && record.clusterId !== input.clusterId) return false;
      if (!actionNeedle) return true;
      const haystack = [record.action, ...record.alternatives.map((option) => option.action)]
        .join("\n")
        .toLowerCase();
      return haystack.includes(actionNeedle);
    })
    .sort((a, b) => {
      const scoreDelta = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return b.timestamp.localeCompare(a.timestamp);
    })
    .slice(0, limit);
}

export async function persistDecisionQualityScores(
  updates: Map<string, number>,
  path: string = decisionLedgerPath()
): Promise<{ updated: number; total: number }> {
  if (updates.size === 0) return { updated: 0, total: 0 };

  const records = await readDecisionLedger(path);
  const byId = new Map(records.map((record) => [record.decisionId, record]));
  let updated = 0;
  for (const [decisionId, score] of updates.entries()) {
    const record = byId.get(decisionId);
    if (!record || record.qualityScore === score) continue;
    await recordDecision(
      {
        key: `decision-score:${decisionId}`,
        actor: "kimi",
        action: "score decision quality",
        trigger: `quality score recomputed for ${decisionId}`,
        rationale: `Quality score set to ${score} based on current decision and failure evidence.`,
        outcome: "success",
        parentDecisionId: decisionId,
        metadata: {
          phase: "quality-score",
          scoreUpdateFor: decisionId,
          qualityScore: score,
        },
      },
      path
    );
    updated++;
  }
  return { updated, total: records.length };
}

function applyQualityScoreUpdates(records: DecisionRecord[]): DecisionRecord[] {
  const scores = new Map<string, number>();
  for (const record of records) {
    const target = scoreUpdateTarget(record);
    if (target && typeof record.metadata?.qualityScore === "number") {
      scores.set(target, record.metadata.qualityScore);
    }
  }
  return records
    .filter((record) => !scoreUpdateTarget(record))
    .map((record) => {
      const score = scores.get(record.decisionId);
      return score === undefined ? record : { ...record, qualityScore: score };
    });
}

function scoreUpdateTarget(record: DecisionRecord): string | undefined {
  return typeof record.metadata?.scoreUpdateFor === "string"
    ? record.metadata.scoreUpdateFor
    : undefined;
}

// ---------------------------------------------------------------------------
// Backward-compatible decision API (legacy callers)
// ---------------------------------------------------------------------------

/** Resolve the decision ledger path for a project or the global fallback. */
export function resolveDecisionsPath(projectRoot?: string): string {
  return projectRoot ? decisionsNdjsonPath(projectRoot) : decisionLedgerPath();
}

/** Legacy alias for resolveProjectRoot used by kimi-doctor and kimi-config. */
export async function resolveDecisionsRoot(fallback?: string): Promise<string> {
  return resolveProjectRoot(fallback);
}

/** Legacy input shape accepted by logDecision/logDecisionEffect. */
export interface LegacyDecisionInput extends Omit<
  DecisionInput,
  "key" | "trigger" | "outcome" | "alternatives"
> {
  /** Derived from action/trigger when omitted. */
  key?: string;
  /** Old name for rationaleBlock. */
  rationaleOverride?: Partial<DecisionRationaleBlock>;
  /** Old name for triggerContext when passed as an object. */
  trigger?: string | Partial<DecisionTriggerContext>;
  /** Old name for outcomeDetail when passed as an object. */
  outcome?: DecisionOutcome | DecisionOutcomeBlock;
  /** Old name for alternativeOptions when passed as objects. */
  alternatives?: string[] | DecisionAlternativeOption[];
}

function normalizeLegacyDecisionInput(input: LegacyDecisionInput): DecisionInput {
  const normalized = { ...input } as DecisionInput;
  const raw = normalized as unknown as Record<string, unknown>;
  if (!normalized.key) {
    normalized.key =
      input.trigger && typeof input.trigger === "object" && input.trigger.capabilityItem
        ? input.trigger.capabilityItem
        : input.action;
  }
  if (input.rationaleOverride) {
    normalized.rationaleBlock = {
      summary: input.rationaleOverride.summary ?? "",
      fullReasoning: input.rationaleOverride.fullReasoning ?? input.rationaleOverride.summary ?? "",
      evidence: input.rationaleOverride.evidence ?? [],
    };
    delete raw.rationaleOverride;
  }
  if (input.trigger && typeof input.trigger === "object") {
    normalized.triggerContext = {
      ...input.trigger,
      summary:
        input.trigger.summary || input.trigger.capabilityItem || input.action || "legacy trigger",
    };
    delete raw.trigger;
  }
  if (input.outcome && typeof input.outcome === "object") {
    normalized.outcomeDetail = input.outcome;
    delete raw.outcome;
  }
  if (
    input.alternatives &&
    input.alternatives.length > 0 &&
    typeof input.alternatives[0] === "object"
  ) {
    normalized.alternativeOptions = input.alternatives as DecisionAlternativeOption[];
    delete raw.alternatives;
  }
  return normalized;
}

/** Legacy alias for recordDecision that accepts older field names. */
export async function logDecision(
  input: LegacyDecisionInput,
  pathOrOptions?: string | { projectRoot?: string }
): Promise<DecisionRecord> {
  const path =
    typeof pathOrOptions === "string"
      ? pathOrOptions
      : resolveDecisionsPath(pathOrOptions?.projectRoot);
  return recordDecision(normalizeLegacyDecisionInput(input), path);
}

/** Legacy alias for readDecisionLedger scoped to a project root. */
export async function readDecisions(projectRoot?: string): Promise<DecisionRecord[]> {
  return readDecisionLedger(resolveDecisionsPath(projectRoot));
}

/** Update the outcome of an existing decision record. */
export async function updateDecisionOutcome(
  decisionId: string,
  outcome: DecisionOutcome | DecisionOutcomeBlock,
  options?: { projectRoot?: string; qualityScore?: number }
): Promise<DecisionRecord | null> {
  const path = resolveDecisionsPath(options?.projectRoot);
  const records = await readDecisionLedger(path);
  const index = records.findIndex(
    (record) => record.decisionId === decisionId || record.id === decisionId
  );
  if (index < 0) return null;
  const record = records[index]!;
  const outcomeBlock: DecisionOutcomeBlock =
    typeof outcome === "string" ? { result: outcome } : outcome;
  const updated: DecisionRecord = {
    ...record,
    outcome: outcomeBlock,
    qualityScore: options?.qualityScore ?? record.qualityScore,
  };
  records[index] = updated;
  await rewriteNdjsonFile(path, records);
  return updated;
}

/** Legacy alias for explainDecision that accepts a decisionId and projectRoot. */
export async function buildWhyReport(
  decisionId: string,
  projectRoot?: string
): Promise<DecisionExplanation> {
  return explainDecision(decisionId, resolveDecisionsPath(projectRoot));
}

/** Effect wrapper around logDecision for legacy callers. */
export function logDecisionEffect(
  input: LegacyDecisionInput,
  options?: { projectRoot?: string; context?: RationaleBuildContext }
): Effect.Effect<DecisionRecord, never> {
  const normalized = normalizeLegacyDecisionInput(input);
  if (options?.context && !normalized.rationaleContext && !normalized.rationaleBlock) {
    normalized.rationaleContext = options.context;
  }
  return Effect.tryPromise({
    try: () => logDecision(normalized, options),
    catch: () => "log-decision-failed",
  }).pipe(Effect.catchAll(() => Effect.succeed(createDecisionRecord(normalized))));
}

/** Current decision ledger schema version written by `logDecision`. */
export const DECISION_SCHEMA_VERSION = 2 satisfies DecisionSchemaVersion;

export interface DecisionDiffField {
  field: string;
  left: unknown;
  right: unknown;
}

export interface DecisionDiffReport {
  leftId: string;
  rightId: string;
  fields: DecisionDiffField[];
}

export interface DecisionListWindowOptions {
  sinceMs: number;
  nowMs?: number;
}

export interface DecisionRecentFilter extends DecisionListWindowOptions {
  type?: string;
}

function decisionTimestampMs(decision: DecisionRecord): number {
  const parsed = Date.parse(decision.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataType(decision: DecisionRecord): string | undefined {
  const meta = decision.metadata;
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}

function constantKeyFromMetadata(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  if (!metadata) return undefined;
  if (typeof metadata.constantKey === "string") return metadata.constantKey;
  const restored = metadata.restoredKeys;
  if (Array.isArray(restored) && typeof restored[0] === "string") return restored[0];
  return undefined;
}

/** Parse compact window strings (`7d`, `24h`, `30m`) to milliseconds. */
export function parseDecisionWindow(window: string): number {
  const match = window.trim().match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`invalid decision window: ${window}`);
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 60 * 1000;
}

export function filterDecisionsByConstant(
  decisions: readonly DecisionRecord[],
  constantKey: string,
  options: DecisionListWindowOptions
): DecisionRecord[] {
  const nowMs = options.nowMs ?? Date.now();
  return decisions.filter((decision) => {
    const ts = decisionTimestampMs(decision);
    if (ts < options.sinceMs || ts > nowMs) return false;
    const key = constantKeyFromMetadata(decision.metadata);
    return key === constantKey;
  });
}

export function filterRecentDecisions(
  decisions: readonly DecisionRecord[],
  options: DecisionRecentFilter
): DecisionRecord[] {
  const nowMs = options.nowMs ?? Date.now();
  return decisions.filter((decision) => {
    const ts = decisionTimestampMs(decision);
    if (ts < options.sinceMs || ts > nowMs) return false;
    if (options.type && metadataType(decision) !== options.type) return false;
    return true;
  });
}

function collectDecisionDiffFields(
  left: unknown,
  right: unknown,
  prefix: string,
  fields: DecisionDiffField[]
): void {
  if (left === right) return;
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftObj = left as Record<string, unknown>;
    const rightObj = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]);
    for (const key of keys) {
      collectDecisionDiffFields(
        leftObj[key],
        rightObj[key],
        prefix ? `${prefix}.${key}` : key,
        fields
      );
    }
    return;
  }
  fields.push({ field: prefix, left, right });
}

export function diffDecisions(left: DecisionRecord, right: DecisionRecord): DecisionDiffReport {
  const fields: DecisionDiffField[] = [];
  collectDecisionDiffFields(left, right, "", fields);
  return {
    leftId: left.decisionId,
    rightId: right.decisionId,
    fields: fields.filter((field) => field.field.length > 0),
  };
}

export function formatDecisionCompact(decision: DecisionRecord): string {
  const date = decision.timestamp.slice(0, 10);
  const type = metadataType(decision) ?? "unknown";
  const meta = decision.metadata ?? {};
  const key = constantKeyFromMetadata(meta) ?? "—";
  const golden =
    typeof meta.goldenVersion === "string" ? `golden v${meta.goldenVersion}` : "golden v?";
  const diff = meta.diff as
    | { invalidKeys?: Array<{ key: string; expected: unknown; actual: unknown }> }
    | undefined;
  const invalid = diff?.invalidKeys?.find((row) => row.key === key);
  const repairPath =
    invalid != null ? `${invalid.expected}->${invalid.actual}->${invalid.expected}` : "—";
  return `${decision.decisionId} | ${date} | ${type} | ${key} | ${repairPath} | ${golden}`;
}
