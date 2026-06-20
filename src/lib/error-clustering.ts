/**
 * Semantic error clustering pipeline (Effect-TS).
 *
 * Embeds failure records, clusters by cosine similarity, persists clusterId
 * assignments to the ledger and metadata to error-clusters.json.
 */

import { Effect } from "effect";
import { dirname } from "path";
import { makeDir, writeTextAsync } from "./bun-io.ts";
import {
  cosineSimilarity,
  decodeEmbedding,
  embedFailure,
  embedText,
  encodeEmbedding,
} from "./error-embedding.ts";
import {
  applyClusterAssignments,
  readFailureRecords,
  writeFailureRecords,
  type FailureTraceRecord,
} from "./failure-ledger.ts";
import { getClusterPlaybook, readClusterPlaybooks } from "./cluster-playbooks.ts";
import { errorClustersPath, failureLedgerPath, traceEventsPath } from "./paths.ts";
import { readTraceEvents, type TraceEvent } from "./trace-ledger.ts";
import { sha256String } from "./utils.ts";

export const DEFAULT_CLUSTER_THRESHOLD = KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD;

export interface FailureClusterInput {
  failurePath?: string;
  tracePath?: string;
  clustersPath?: string;
  threshold?: number;
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
  id: string;
  label: string;
  size: number;
  confidence: number;
  taxonomyCounts: Record<string, number>;
  tools: string[];
  suggestedFix?: string;
  autoFix?: string;
  hasPlaybook: boolean;
  members: ClusterMember[];
}

export interface ClusterSummary {
  clusterId: string;
  count: number;
  representativeError: {
    summary: string;
    traceId?: string;
    errorId?: string;
  };
  topTaxonomy: string | null;
  hasPlaybook: boolean;
  confidence?: number;
  suggestedFix?: string;
  autoFix?: string;
}

export interface ErrorClusterReport {
  schemaVersion: 1;
  generatedAt: string;
  threshold: number;
  totalFailures: number;
  clusters: ErrorCluster[];
  summaries: ClusterSummary[];
}

export interface ClusterMatch {
  cluster: ErrorCluster;
  confidence: number;
}

export interface ErrorSuggestion {
  errorId: string;
  clusterId: string | null;
  confidence: number;
  cluster?: ErrorCluster;
  playbook?: {
    title: string;
    command?: string[];
    confidence: number;
  };
  similarErrors: ClusterMember[];
  recommendation: string;
}

interface EmbeddedFailure {
  record: FailureTraceRecord;
  text: string;
  vector: Float32Array;
}

interface MutableCluster {
  id: string;
  members: EmbeddedFailure[];
  centroid: Float32Array;
  similarities: number[];
}

export function clusterFailureLedgerEffect(
  options: FailureClusterInput = {}
): Effect.Effect<ErrorClusterReport, never> {
  return Effect.gen(function* () {
    const threshold = options.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
    const failurePath = options.failurePath ?? failureLedgerPath();
    const tracePath = options.tracePath ?? traceEventsPath();
    const clustersPath = options.clustersPath ?? errorClustersPath();
    const persist = options.persist ?? true;

    const [failures, traces, playbooks] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => readFailureRecords(failurePath),
          catch: () => new Error("failure-read"),
        }).pipe(Effect.catchAll(() => Effect.succeed([] as FailureTraceRecord[]))),
        Effect.tryPromise({
          try: () => readTraceEvents(tracePath),
          catch: () => new Error("trace-read"),
        }).pipe(Effect.catchAll(() => Effect.succeed([] as TraceEvent[]))),
        Effect.tryPromise({
          try: () => readClusterPlaybooks(),
          catch: () => new Error("playbook-read"),
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed({ schemaVersion: 1 as const, updatedAt: "", playbooks: {} })
          )
        ),
      ],
      { concurrency: "unbounded" }
    );

    const embedded = yield* Effect.sync(() =>
      failures
        .filter((failure) => (failure.output || "").trim().length > 0)
        .map((failure) => embedRecord(failure, traces))
    );

    const { clusters, assignments, encodings } = yield* Effect.sync(() =>
      buildClusters(embedded, threshold)
    );

    if (persist && failures.length > 0) {
      yield* Effect.tryPromise({
        try: () =>
          writeFailureRecords(
            applyClusterAssignments(failures, assignments, encodings),
            failurePath
          ),
        catch: () => new Error("failure-write"),
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    const formatted = yield* Effect.sync(() =>
      clusters.map((cluster) => formatCluster(cluster, playbooks.playbooks))
    );
    formatted.sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));

    const report: ErrorClusterReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      threshold,
      totalFailures: embedded.length,
      clusters: formatted,
      summaries: formatted.map(toSummary),
    };

    if (persist) {
      yield* Effect.tryPromise({
        try: () => writeClusterMetadata(report, clustersPath),
        catch: () => new Error("cluster-metadata-write"),
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    return report;
  });
}

export function suggestForErrorEffect(
  errorId: string,
  options: FailureClusterInput = {}
): Effect.Effect<ErrorSuggestion | null, never> {
  return Effect.gen(function* () {
    const report = yield* clusterFailureLedgerEffect({ ...options, persist: false });
    const failurePath = options.failurePath ?? failureLedgerPath();
    const failures = yield* Effect.tryPromise({
      try: () => readFailureRecords(failurePath),
      catch: () => new Error("failure-read"),
    }).pipe(Effect.catchAll(() => Effect.succeed([] as FailureTraceRecord[])));
    const record = failures.find((item) => item.errorId === errorId);
    if (!record) return null;

    const cluster =
      report.clusters.find((item) => item.members.some((member) => member.errorId === errorId)) ??
      matchByEmbedding(record, report.clusters);

    if (!cluster) {
      return {
        errorId,
        clusterId: null,
        confidence: 0,
        similarErrors: [],
        recommendation: "No cluster match — run manual triage and add taxonomy coverage.",
      };
    }

    const playbooks = yield* Effect.tryPromise({
      try: () => readClusterPlaybooks(),
      catch: () => new Error("playbook-read"),
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ schemaVersion: 1 as const, updatedAt: "", playbooks: {} })
      )
    );
    const playbook = getClusterPlaybook(cluster.id, playbooks);

    return {
      errorId,
      clusterId: cluster.id,
      confidence: cluster.confidence,
      cluster,
      playbook: playbook
        ? {
            title: playbook.title,
            command: playbook.command,
            confidence: playbook.confidence,
          }
        : undefined,
      similarErrors: cluster.members.filter((member) => member.errorId !== errorId).slice(0, 5),
      recommendation: playbook
        ? `Apply known playbook: ${playbook.title}`
        : (cluster.suggestedFix ??
          "Review similar past errors and add a healing playbook for this cluster."),
    };
  });
}

export interface ErrorIdSuggestion {
  errorId: string;
  confidence: number;
  cluster?: {
    clusterId: string;
    count: number;
    topTaxonomy: string | null;
  };
  record?: FailureTraceRecord;
  playbook?: {
    suggestedFix?: string;
    autoFix?: string;
  };
}

export function suggestForErrorIdEffect(
  errorId: string,
  options: FailureClusterInput = {}
): Effect.Effect<ErrorIdSuggestion | null, never> {
  return Effect.gen(function* () {
    const suggestion = yield* suggestForErrorEffect(errorId, options);
    if (!suggestion) return null;
    const cluster = suggestion.cluster;
    const failurePath = options.failurePath ?? failureLedgerPath();
    const failures = yield* Effect.tryPromise({
      try: () => readFailureRecords(failurePath),
      catch: () => new Error("failure-read"),
    }).pipe(Effect.catchAll(() => Effect.succeed([] as FailureTraceRecord[])));
    const record = failures.find((item) => item.errorId === errorId);
    const topTaxonomy = cluster
      ? (Object.entries(cluster.taxonomyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
      : null;
    return {
      errorId,
      confidence: suggestion.confidence,
      cluster: cluster ? { clusterId: cluster.id, count: cluster.size, topTaxonomy } : undefined,
      record,
      playbook: cluster
        ? { suggestedFix: cluster.suggestedFix, autoFix: cluster.autoFix }
        : undefined,
    };
  });
}

export function matchErrorToClusters(
  errorText: string,
  clusters: ErrorCluster[]
): ClusterMatch | null {
  const vector = embedText(errorText);
  let best: ClusterMatch | null = null;
  for (const cluster of clusters) {
    const clusterText = cluster.members.map((member) => member.output).join("\n");
    const clusterVector = embedText(clusterText);
    const confidence = cosineSimilarity(vector, clusterVector);
    if (!best || confidence > best.confidence) best = { cluster, confidence };
  }
  return best && best.confidence > 0 ? best : null;
}

function embedRecord(record: FailureTraceRecord, traces: TraceEvent[]): EmbeddedFailure {
  if (record.embedding) {
    try {
      return {
        record,
        text: "",
        vector: decodeEmbedding(record.embedding),
      };
    } catch {
      // Re-embed below.
    }
  }
  const { text, vector } = embedFailure(record, traces);
  return { record, text, vector };
}

function buildClusters(
  records: EmbeddedFailure[],
  threshold: number
): {
  clusters: MutableCluster[];
  assignments: Map<string, string>;
  encodings: Map<string, string>;
} {
  const clusters: MutableCluster[] = [];
  const assignments = new Map<string, string>();
  const encodings = new Map<string, string>();

  for (const record of records) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let index = 0; index < clusters.length; index++) {
      const similarity = cosineSimilarity(record.vector, clusters[index].centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestSimilarity >= threshold) {
      const cluster = clusters[bestIndex];
      cluster.members.push(record);
      cluster.similarities.push(bestSimilarity);
      cluster.centroid = mergeCentroid(cluster.members);
      if (record.record.errorId) {
        assignments.set(record.record.errorId, cluster.id);
        encodings.set(record.record.errorId, encodeEmbedding(record.vector));
      }
    } else {
      const id = `cluster-${sha256String(record.text || record.record.output || "").slice(0, 12)}`;
      const cluster: MutableCluster = {
        id,
        members: [record],
        centroid: new Float32Array(record.vector),
        similarities: [1],
      };
      clusters.push(cluster);
      if (record.record.errorId) {
        assignments.set(record.record.errorId, id);
        encodings.set(record.record.errorId, encodeEmbedding(record.vector));
      }
    }
  }

  return { clusters, assignments, encodings };
}

function mergeCentroid(members: EmbeddedFailure[]): Float32Array {
  const centroid = new Float32Array(members[0].vector.length);
  for (const member of members) {
    for (let i = 0; i < centroid.length; i++) {
      centroid[i] += member.vector[i] / members.length;
    }
  }
  const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  if (norm > 0) {
    for (let i = 0; i < centroid.length; i++) centroid[i] /= norm;
  }
  return centroid;
}

function formatCluster(
  cluster: MutableCluster,
  playbooks: Record<string, { outcome: string }>
): ErrorCluster {
  const taxonomyCounts: Record<string, number> = {};
  const tools = new Set<string>();
  const members = cluster.members.map((member, index) => {
    const taxonomyId = member.record.taxonomyId || member.record.categoryId || "unknown";
    taxonomyCounts[taxonomyId] = (taxonomyCounts[taxonomyId] || 0) + 1;
    if (member.record.toolName) tools.add(member.record.toolName);
    return {
      errorId: member.record.errorId,
      traceId: member.record.traceId,
      toolName: member.record.toolName || "unknown",
      taxonomyId,
      output: (member.record.output || "").slice(0, 240),
      similarity: round(cluster.similarities[index] ?? 1),
    };
  });

  const suggestion = deriveSuggestion(cluster.members);
  const playbookRecord = playbooks[cluster.id];
  const hasPlaybook = playbookRecord?.outcome === "success";

  return {
    id: cluster.id,
    label: deriveLabel(cluster.members),
    size: cluster.members.length,
    confidence: round(average(cluster.similarities)),
    taxonomyCounts,
    tools: [...tools].sort(),
    hasPlaybook,
    ...(suggestion.suggestedFix ? { suggestedFix: suggestion.suggestedFix } : {}),
    ...(suggestion.autoFix ? { autoFix: suggestion.autoFix } : {}),
    members,
  };
}

function toSummary(cluster: ErrorCluster): ClusterSummary {
  const representative = cluster.members[cluster.members.length - 1] ?? cluster.members[0] ?? null;
  const topTaxonomy = dominantTaxonomy(cluster.taxonomyCounts);
  return {
    clusterId: cluster.id,
    count: cluster.size,
    representativeError: {
      summary: representative?.output ?? cluster.label,
      traceId: representative?.traceId,
      errorId: representative?.errorId,
    },
    topTaxonomy: topTaxonomy === "unknown" ? null : topTaxonomy,
    hasPlaybook: cluster.hasPlaybook,
    confidence: cluster.confidence,
    suggestedFix: cluster.suggestedFix,
    autoFix: cluster.autoFix,
  };
}

function matchByEmbedding(
  record: FailureTraceRecord,
  clusters: ErrorCluster[]
): ErrorCluster | undefined {
  const match = matchErrorToClusters(record.output || "", clusters);
  return match?.cluster;
}

function deriveLabel(members: EmbeddedFailure[]): string {
  const text = members.map((member) => member.text).join(" ");
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([token]) => token);
  return top.length > 0 ? top.join(" ") : "unclassified failure";
}

function deriveSuggestion(members: EmbeddedFailure[]): {
  suggestedFix?: string;
  autoFix?: string;
} {
  const known = members.find((member) => member.record.suggestion || member.record.autoFix)?.record;
  if (known?.suggestion || known?.autoFix) {
    return { suggestedFix: known.suggestion, autoFix: known.autoFix };
  }
  const taxonomyIds = members.map(
    (member) => member.record.taxonomyId || member.record.categoryId || "unknown"
  );
  if (taxonomyIds.every((id) => id === "unknown")) {
    return {
      suggestedFix: "Review this cluster and add a taxonomy rule or healing playbook.",
    };
  }
  return {};
}

function dominantTaxonomy(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "unknown";
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0][0];
}

async function writeClusterMetadata(report: ErrorClusterReport, path: string): Promise<void> {
  makeDir(dirname(path), { recursive: true });
  await writeTextAsync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: report.generatedAt,
        threshold: report.threshold,
        totalFailures: report.totalFailures,
        summaries: report.summaries,
      },
      null,
      2
    )}\n`
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
