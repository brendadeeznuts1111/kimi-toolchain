/**
 * Failure ledger read/write with embedding pre-compute on insert.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { clusterMetadataPath, failureLedgerPath } from "./paths.ts";
import {
  buildEmbeddableText,
  embeddingFromBase64,
  embeddingToBase64,
  getEmbedder,
  type Embedder,
} from "./error-embedding.ts";
import {
  readFailureTraceRecords,
  readTraceEvents,
  type FailureTraceRecord,
  type TraceEvent,
} from "./trace-ledger.ts";
import { safeParse, sha256String } from "./utils.ts";
import type { ClassifiedFailure } from "./error-taxonomy.ts";

export const CLUSTER_METADATA_SCHEMA_VERSION = 2;

export interface ClusterMetadataEntry {
  clusterId: string;
  count: number;
  representativeError: {
    summary: string;
    traceId?: string;
    errorId?: string;
  };
  topTaxonomy: string;
  hasPlaybook: boolean;
  medoidErrorId?: string;
  confidence: number;
  taxonomyCounts: Record<string, number>;
  tools: string[];
  suggestedFix?: string;
  autoFix?: string;
  playbookId?: string;
}

export interface ClusterMetadataFile {
  schemaVersion: typeof CLUSTER_METADATA_SCHEMA_VERSION;
  generatedAt: string;
  threshold: number;
  embedder: string;
  totalFailures: number;
  clusters: ClusterMetadataEntry[];
}

export function createErrorId(
  record: Pick<FailureTraceRecord, "timestamp" | "toolName" | "output">
): string {
  const stamp = record.timestamp || new Date().toISOString();
  const tool = record.toolName || "unknown";
  const preview = (record.output || "").slice(0, 200);
  return `err-${sha256String(`${stamp}:${tool}:${preview}`).slice(0, 12)}`;
}

export function stepDescriptionForTrace(traceId: string | undefined, traces: TraceEvent[]): string {
  if (!traceId) return "";
  const events = traces.filter((event) => event.traceId === traceId);
  if (events.length === 0) return "";
  const event = events[events.length - 1];
  const command = event.command?.join(" ");
  return command ? `${event.tool}: ${command}` : event.tool;
}

export function causalChainForRecord(record: FailureTraceRecord, traces: TraceEvent[]): string[] {
  const chain: string[] = [];
  let traceId = record.parentTraceId;
  const seen = new Set<string>();
  while (traceId && !seen.has(traceId)) {
    seen.add(traceId);
    const step = stepDescriptionForTrace(traceId, traces);
    if (step) chain.unshift(step);
    const parent = traces.find((event) => event.traceId === traceId)?.parentTraceId;
    traceId = parent;
  }
  return chain.slice(0, 6);
}

export async function buildEmbeddableTextForRecord(
  record: FailureTraceRecord,
  traces: TraceEvent[]
): Promise<string> {
  return buildEmbeddableText({
    output: record.output,
    taxonomyId: record.taxonomyId,
    categoryId: record.categoryId,
    toolName: record.toolName,
    stepDescription: stepDescriptionForTrace(record.traceId, traces),
    causalChain: causalChainForRecord(record, traces),
    environment: record.context?.environment,
  });
}

export async function ensureRecordEmbedding(
  record: FailureTraceRecord,
  traces: TraceEvent[],
  embedder?: Embedder
): Promise<Float32Array> {
  if (record.embedding) return embeddingFromBase64(record.embedding);
  const model = embedder ?? (await getEmbedder());
  const text = await buildEmbeddableTextForRecord(record, traces);
  return model.embed(text);
}

export async function appendFailureRecord(
  record: ClassifiedFailure & Partial<FailureTraceRecord>,
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord> {
  mkdirSync(dirname(path), { recursive: true });
  const traces = await readTraceEvents();
  const errorId = record.errorId || createErrorId(record);
  const traceId = record.traceId || Bun.env.KIMI_TRACE_ID;
  const embedder = await getEmbedder();
  const embedding = embeddingToBase64(
    await ensureRecordEmbedding({ ...record, errorId, traceId }, traces, embedder)
  );
  const line: FailureTraceRecord = {
    ...record,
    errorId,
    traceId,
    parentTraceId: record.parentTraceId || Bun.env.KIMI_PARENT_TRACE_ID,
    embedding,
  };
  appendFileSync(path, `${JSON.stringify(line)}\n`);
  return line;
}

export async function readFailureRecords(
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord[]> {
  return readFailureTraceRecords(path);
}

export async function rewriteFailureLedger(
  records: FailureTraceRecord[],
  path: string = failureLedgerPath()
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "");
}

export async function writeClusterMetadata(
  metadata: ClusterMetadataFile,
  path: string = clusterMetadataPath()
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function readClusterMetadata(
  path: string = clusterMetadataPath()
): Promise<ClusterMetadataFile | null> {
  if (!existsSync(path)) return null;
  const parsed = safeParse<ClusterMetadataFile | null>(await Bun.file(path).text(), null);
  if (!parsed || parsed.schemaVersion !== CLUSTER_METADATA_SCHEMA_VERSION) return null;
  return parsed;
}

export async function findFailureByErrorId(
  errorId: string,
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord | null> {
  const records = await readFailureRecords(path);
  return records.find((record) => record.errorId === errorId) ?? null;
}
