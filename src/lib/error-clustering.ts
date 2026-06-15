/**
 * Semantic failure clustering via local 384-dim embeddings + DBSCAN.
 */

import { Effect } from "effect";
import {
  causalChainForRecord,
  ensureRecordEmbedding,
  readClusterMetadata,
  rewriteFailureLedger,
  stepDescriptionForTrace,
  writeClusterMetadata,
  type ClusterMetadataEntry,
  type ClusterMetadataFile,
} from "./failure-ledger.ts";
import { cosineSimilarity, getEmbedder, hashEmbed384, type Embedder } from "./error-embedding.ts";
import { appendMemoryRecord } from "./institutional-memory.ts";
import { failureLedgerPath, traceEventsPath } from "./paths.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { sha256String } from "./utils.ts";
import {
  readFailureTraceRecords,
  readTraceEvents,
  type FailureTraceRecord,
  type TraceEvent,
} from "./trace-ledger.ts";

export interface FailureClusterInput {
  failurePath?: string;
  tracePath?: string;
  threshold?: number;
  minClusterSize?: number;
  persist?: boolean;
}

export interface ClusterMember {
  errorId?: string;
  traceId?: string;
  toolName: string;
  taxonomyId: string;
  output: string;
  similarity: number;
}

export interface ErrorCluster {
  clusterId: string;
  count: number;
  representativeError: {
    summary: string;
    traceId?: string;
    errorId?: string;
  };
  topTaxonomy: string;
  hasPlaybook: boolean;
  confidence: number;
  taxonomyCounts: Record<string, number>;
  tools: string[];
  suggestedFix?: string;
  autoFix?: string;
  playbookId?: string;
  members: ClusterMember[];
}

export interface ErrorClusterReport {
  schemaVersion: 2;
  generatedAt: string;
  threshold: number;
  embedder: string;
  totalFailures: number;
  clusters: ErrorCluster[];
}

export interface ClusterMatch {
  cluster: ErrorCluster;
  confidence: number;
}

interface EmbeddedFailure {
  record: FailureTraceRecord;
  vector: Float32Array;
  similarities: number[];
}

const DEFAULT_MIN_CLUSTER_SIZE = 1;
const KNOWN_PLAYBOOK_TAXONOMIES = new Set([
  "format_check_failure",
  "timeout_hang",
  "orphan_process",
  "lockfile_issue",
  "command_not_found",
  "typecheck_failure",
  "lint_failure",
  "test_failure",
  "max_steps_exceeded",
]);

export function clusterFailureLedgerEffect(
  options: FailureClusterInput = {}
): Effect.Effect<ErrorClusterReport, never> {
  return Effect.gen(function* () {
    const threshold = options.threshold ?? KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD;
    const failurePath = options.failurePath ?? failureLedgerPath();
    const tracePath = options.tracePath ?? traceEventsPath();
    const persist = options.persist ?? true;

    const [failures, traces, embedder] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => readFailureTraceRecords(failurePath),
          catch: () => "read-failures-failed",
        }).pipe(Effect.catchAll(() => Effect.succeed([] as FailureTraceRecord[]))),
        Effect.tryPromise({
          try: () => readTraceEvents(tracePath),
          catch: () => "read-traces-failed",
        }).pipe(Effect.catchAll(() => Effect.succeed([] as TraceEvent[]))),
        Effect.tryPromise({
          try: () => getEmbedder(),
          catch: () => "embedder-failed",
        }).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => ({
              name: "hash" as const,
              embed: async (text: string) => hashEmbed384(text),
              embedBatch: async (texts: string[]) => texts.map((text) => hashEmbed384(text)),
            }))
          )
        ),
      ],
      { concurrency: 3 }
    );

    const embedded = yield* Effect.tryPromise({
      try: async () => embedFailures(failures, traces, embedder),
      catch: () => "embed-failed",
    }).pipe(Effect.catchAll(() => Effect.succeed([] as EmbeddedFailure[])));

    const labels = dbscan(
      embedded.map((item) => item.vector),
      1 - threshold,
      options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE
    );
    const grouped = groupByLabel(embedded, labels);
    const clusters = grouped.map((group) => formatCluster(group));

    if (persist && options.failurePath === undefined) {
      yield* persistClusterResults(failures, traces, clusters, {
        threshold,
        embedder: embedder.name,
      });
    }

    clusters.sort((a, b) => b.count - a.count || a.clusterId.localeCompare(b.clusterId));
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      threshold,
      embedder: embedder.name,
      totalFailures: embedded.length,
      clusters,
    };
  });
}

export async function clusterFailureLedger(
  options: FailureClusterInput = {}
): Promise<ErrorClusterReport> {
  return Effect.runPromise(clusterFailureLedgerEffect(options));
}

export function matchErrorToClusters(
  errorText: string,
  clusters: ErrorCluster[],
  vector?: Float32Array
): ClusterMatch | null {
  const query = vector ?? hashEmbed384(errorText);
  let best: ClusterMatch | null = null;
  for (const cluster of clusters) {
    const medoid = cluster.members[0];
    if (!medoid) continue;
    const clusterVector = hashEmbed384(medoid.output);
    const confidence = cosineSimilarity(query, clusterVector);
    if (!best || confidence > best.confidence) best = { cluster, confidence };
  }
  return best && best.confidence > 0 ? best : null;
}

export async function suggestForErrorId(
  errorId: string,
  options: FailureClusterInput = {}
): Promise<{
  errorId: string;
  record?: FailureTraceRecord;
  cluster?: ErrorCluster;
  confidence: number;
  similarErrors: ClusterMember[];
  playbook?: { suggestedFix?: string; autoFix?: string; playbookId?: string };
}> {
  const report = await clusterFailureLedger(options);
  const record = (await readFailureTraceRecords(options.failurePath)).find(
    (entry) => entry.errorId === errorId
  );
  if (!record) {
    return { errorId, confidence: 0, similarErrors: [] };
  }
  const traces = await readTraceEvents(options.tracePath);
  const vector = await ensureRecordEmbedding(record, traces);
  const match = matchErrorToClusters(record.output || "", report.clusters, vector);
  const cluster = match?.cluster;
  const similarErrors = cluster
    ? cluster.members.filter((member) => member.errorId !== errorId).slice(0, 5)
    : [];
  return {
    errorId,
    record,
    cluster,
    confidence: match?.confidence ?? 0,
    similarErrors,
    playbook: cluster?.hasPlaybook
      ? {
          suggestedFix: cluster.suggestedFix,
          autoFix: cluster.autoFix,
          playbookId: cluster.playbookId,
        }
      : undefined,
  };
}

function embedFailures(
  failures: FailureTraceRecord[],
  traces: TraceEvent[],
  embedder: Embedder
): Promise<EmbeddedFailure[]> {
  return Effect.runPromise(
    Effect.all(
      failures
        .filter((failure) => (failure.output || "").trim().length > 0)
        .map((record) =>
          Effect.tryPromise({
            try: async () => ({
              record,
              vector: await ensureRecordEmbedding(record, traces, embedder),
              similarities: [1],
            }),
            catch: () => "embed-record-failed",
          }).pipe(Effect.catchAll(() => Effect.succeed(null)))
        ),
      { concurrency: 8 }
    ).pipe(Effect.map((items) => items.filter((item): item is EmbeddedFailure => item !== null)))
  );
}

function dbscan(vectors: Float32Array[], eps: number, minPts: number): number[] {
  const labels = Array.from<number>({ length: vectors.length }).fill(-1);
  let clusterId = 0;

  for (let index = 0; index < vectors.length; index++) {
    if (labels[index] !== -1) continue;
    const neighbors = regionQuery(vectors, index, eps);
    if (neighbors.length < minPts) continue;
    expandCluster(vectors, labels, index, neighbors, clusterId, eps, minPts);
    clusterId++;
  }

  let noiseCluster = clusterId;
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] !== -1) continue;
    labels[index] = noiseCluster++;
  }
  return labels;
}

function regionQuery(vectors: Float32Array[], pointIndex: number, eps: number): number[] {
  const neighbors: number[] = [];
  for (let index = 0; index < vectors.length; index++) {
    if (cosineDistance(vectors[pointIndex], vectors[index]) <= eps) neighbors.push(index);
  }
  return neighbors;
}

function expandCluster(
  vectors: Float32Array[],
  labels: number[],
  pointIndex: number,
  neighbors: number[],
  clusterId: number,
  eps: number,
  minPts: number
): void {
  labels[pointIndex] = clusterId;
  const queue = [...neighbors];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    if (labels[current] === -1) labels[current] = clusterId;
    if (labels[current] !== -1 && labels[current] !== clusterId) continue;
    labels[current] = clusterId;
    const currentNeighbors = regionQuery(vectors, current, eps);
    if (currentNeighbors.length >= minPts) {
      for (const neighbor of currentNeighbors) {
        if (!queue.includes(neighbor)) queue.push(neighbor);
      }
    }
  }
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}

function groupByLabel(items: EmbeddedFailure[], labels: number[]): EmbeddedFailure[][] {
  const groups = new Map<number, EmbeddedFailure[]>();
  for (let index = 0; index < items.length; index++) {
    const label = labels[index];
    const group = groups.get(label) || [];
    group.push(items[index]);
    groups.set(label, group);
  }
  return [...groups.values()];
}

function formatCluster(group: EmbeddedFailure[]): ErrorCluster {
  const medoid = findMedoid(group);
  for (const member of group) {
    member.similarities = [cosineSimilarity(member.vector, medoid.vector)];
  }
  group.sort(
    (a, b) =>
      (b.similarities[0] ?? 0) - (a.similarities[0] ?? 0) ||
      stableRecordKey(a.record).localeCompare(stableRecordKey(b.record))
  );

  const taxonomyCounts: Record<string, number> = {};
  const tools = new Set<string>();
  const members: ClusterMember[] = group.map((member) => {
    const taxonomyId = member.record.taxonomyId || member.record.categoryId || "unknown";
    taxonomyCounts[taxonomyId] = (taxonomyCounts[taxonomyId] || 0) + 1;
    if (member.record.toolName) tools.add(member.record.toolName);
    return {
      errorId: member.record.errorId,
      traceId: member.record.traceId,
      toolName: member.record.toolName || "unknown",
      taxonomyId,
      output: (member.record.output || "").slice(0, 240),
      similarity: round(member.similarities[0] ?? 1),
    };
  });

  const topTaxonomy = dominantTaxonomy(taxonomyCounts);
  const suggestion = deriveSuggestion(group, topTaxonomy);
  const clusterSeed = group.map((member) => stableRecordKey(member.record)).join("\n");
  const clusterId = `cluster-${sha256String(clusterSeed).slice(0, 12)}`;
  const hasPlaybook = KNOWN_PLAYBOOK_TAXONOMIES.has(topTaxonomy) || !!suggestion.autoFix;

  return {
    clusterId,
    count: group.length,
    representativeError: {
      summary: summarizeOutput(medoid.record.output || ""),
      traceId: medoid.record.traceId,
      errorId: medoid.record.errorId,
    },
    topTaxonomy,
    hasPlaybook,
    confidence: round(average(group.map((member) => member.similarities[0] ?? 1))),
    taxonomyCounts,
    tools: [...tools].sort(),
    ...(suggestion.suggestedFix ? { suggestedFix: suggestion.suggestedFix } : {}),
    ...(suggestion.autoFix ? { autoFix: suggestion.autoFix } : {}),
    ...(hasPlaybook ? { playbookId: topTaxonomy } : {}),
    members,
  };
}

function findMedoid(group: EmbeddedFailure[]): EmbeddedFailure {
  let best = group[0];
  let bestScore = -1;
  for (const candidate of group) {
    const score = average(group.map((member) => cosineSimilarity(candidate.vector, member.vector)));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function deriveSuggestion(
  group: EmbeddedFailure[],
  topTaxonomy: string
): { suggestedFix?: string; autoFix?: string } {
  const known = group
    .map((member) => member.record)
    .find((record) => record.suggestion || record.autoFix || record.healedPlaybookId);
  if (known?.suggestion || known?.autoFix) {
    return { suggestedFix: known.suggestion, autoFix: known.autoFix };
  }
  if (topTaxonomy === "unknown") {
    return {
      suggestedFix: "Review this cluster and add taxonomy coverage or a healing playbook.",
    };
  }
  return {};
}

function persistClusterResults(
  failures: FailureTraceRecord[],
  traces: TraceEvent[],
  clusters: ErrorCluster[],
  meta: { threshold: number; embedder: string }
): Effect.Effect<void, never> {
  return Effect.tryPromise({
    try: async () => {
      const byErrorId = new Map<string, string>();
      for (const cluster of clusters) {
        for (const member of cluster.members) {
          if (member.errorId) byErrorId.set(member.errorId, cluster.clusterId);
        }
      }
      const updated = failures.map((record) => ({
        ...record,
        clusterId: record.errorId ? byErrorId.get(record.errorId) : record.clusterId,
      }));
      await rewriteFailureLedger(updated);
      const metadata: ClusterMetadataFile = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        threshold: meta.threshold,
        embedder: meta.embedder,
        totalFailures: failures.length,
        clusters: clusters.map(toMetadataEntry),
      };
      await writeClusterMetadata(metadata);
      const trace = ensureProcessTrace();
      for (const cluster of clusters) {
        for (const member of cluster.members) {
          if (!member.errorId) continue;
          try {
            appendMemoryRecord({
              actionType: "cluster_assignment",
              rationale: `Assigned error ${member.errorId} to cluster ${cluster.clusterId} (${cluster.topTaxonomy})`,
              outcome: "success",
              actor: "auto",
              traceId: member.traceId ?? trace.traceId,
              errorId: member.errorId,
              clusterId: cluster.clusterId,
              clusterConfidence: cluster.confidence,
              payloadSummary: `count=${cluster.count} playbook=${cluster.hasPlaybook}`,
            });
          } catch {
            // best-effort memory
          }
        }
      }
      void traces;
    },
    catch: () => "persist-failed",
  }).pipe(Effect.catchAll(() => Effect.void));
}

function toMetadataEntry(cluster: ErrorCluster): ClusterMetadataEntry {
  return {
    clusterId: cluster.clusterId,
    count: cluster.count,
    representativeError: cluster.representativeError,
    topTaxonomy: cluster.topTaxonomy,
    hasPlaybook: cluster.hasPlaybook,
    medoidErrorId: cluster.representativeError.errorId,
    confidence: cluster.confidence,
    taxonomyCounts: cluster.taxonomyCounts,
    tools: cluster.tools,
    suggestedFix: cluster.suggestedFix,
    autoFix: cluster.autoFix,
    playbookId: cluster.playbookId,
  };
}

function dominantTaxonomy(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "unknown";
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0][0] || "unknown";
}

function summarizeOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 160);
}

function stableRecordKey(record: FailureTraceRecord): string {
  return `${record.errorId || ""}:${record.timestamp || ""}:${record.output || ""}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function loadCachedClusters(): Promise<ClusterMetadataFile | null> {
  return readClusterMetadata();
}

export function buildEmbeddablePreview(record: FailureTraceRecord, traces: TraceEvent[]): string {
  return [
    (record.output || "").slice(0, 512),
    stepDescriptionForTrace(record.traceId, traces),
    record.taxonomyId ? `taxonomy:${record.taxonomyId}` : "",
    ...causalChainForRecord(record, traces).map((step) => `cause:${step}`),
  ]
    .filter(Boolean)
    .join("\n");
}
