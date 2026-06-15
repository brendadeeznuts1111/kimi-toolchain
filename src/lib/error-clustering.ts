/**
 * Local semantic-ish clustering for failure-ledger records.
 *
 * This intentionally avoids model downloads and external services. It builds a
 * normalized lexical vector from failure output, taxonomy, tool, context, and
 * trace errors, then greedily clusters by cosine similarity.
 */

import { failureLedgerPath, traceEventsPath } from "./paths.ts";
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
}

export interface ClusterMember {
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
  members: ClusterMember[];
}

export interface ErrorClusterReport {
  schemaVersion: 1;
  generatedAt: string;
  threshold: number;
  totalFailures: number;
  clusters: ErrorCluster[];
}

export interface ClusterMatch {
  cluster: ErrorCluster;
  confidence: number;
}

interface EmbeddedFailure {
  record: FailureTraceRecord;
  text: string;
  vector: Map<string, number>;
  traceErrors: string[];
}

interface MutableCluster {
  members: EmbeddedFailure[];
  centroid: Map<string, number>;
  similarities: number[];
}

const DEFAULT_CLUSTER_THRESHOLD = 0.42;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export async function clusterFailureLedger(
  options: FailureClusterInput = {}
): Promise<ErrorClusterReport> {
  const threshold = options.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const [failures, traces] = await Promise.all([
    readFailureTraceRecords(options.failurePath ?? failureLedgerPath()),
    readTraceEvents(options.tracePath ?? traceEventsPath()),
  ]);
  const embedded = failures
    .filter((failure) => (failure.output || "").trim().length > 0)
    .map((failure) => embedFailure(failure, traces));
  const clusters = buildClusters(embedded, threshold).map(formatCluster);
  clusters.sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    threshold,
    totalFailures: embedded.length,
    clusters,
  };
}

export function matchErrorToClusters(
  errorText: string,
  clusters: ErrorCluster[]
): ClusterMatch | null {
  const vector = vectorize(errorText);
  let best: ClusterMatch | null = null;
  for (const cluster of clusters) {
    const clusterVector = vectorize(cluster.members.map((member) => member.output).join("\n"));
    const confidence = cosine(vector, clusterVector);
    if (!best || confidence > best.confidence) best = { cluster, confidence };
  }
  return best && best.confidence > 0 ? best : null;
}

export function vectorize(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const vector = new Map<string, number>();
  for (const token of tokens) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  for (let index = 0; index < tokens.length - 1; index++) {
    const bigram = `${tokens[index]}_${tokens[index + 1]}`;
    vector.set(bigram, (vector.get(bigram) || 0) + 1.5);
  }
  return vector;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [key, value] of a.entries()) {
    dot += value * (b.get(key) || 0);
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildClusters(records: EmbeddedFailure[], threshold: number): MutableCluster[] {
  const clusters: MutableCluster[] = [];
  for (const record of records) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let index = 0; index < clusters.length; index++) {
      const similarity = cosine(record.vector, clusters[index].centroid);
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
    } else {
      clusters.push({
        members: [record],
        centroid: new Map(record.vector),
        similarities: [1],
      });
    }
  }
  return clusters;
}

function embedFailure(record: FailureTraceRecord, traces: TraceEvent[]): EmbeddedFailure {
  const traceErrors = traces
    .filter((event) => event.traceId === record.traceId || event.parentTraceId === record.traceId)
    .map((event) => event.error)
    .filter((error): error is string => !!error);
  const text = [
    record.toolName,
    record.taxonomyId || record.categoryId,
    record.taxonomyId || record.categoryId,
    record.taxonomyId || record.categoryId,
    record.output,
    record.severity,
    ...traceErrors,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    record,
    text,
    vector: vectorize(text),
    traceErrors,
  };
}

function mergeCentroid(members: EmbeddedFailure[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const member of members) {
    for (const [key, value] of member.vector.entries()) {
      merged.set(key, (merged.get(key) || 0) + value / members.length);
    }
  }
  return merged;
}

function formatCluster(cluster: MutableCluster): ErrorCluster {
  const taxonomyCounts: Record<string, number> = {};
  const tools = new Set<string>();
  const members = cluster.members.map((member, index) => {
    const taxonomyId = member.record.taxonomyId || member.record.categoryId || "unknown";
    taxonomyCounts[taxonomyId] = (taxonomyCounts[taxonomyId] || 0) + 1;
    if (member.record.toolName) tools.add(member.record.toolName);
    return {
      traceId: member.record.traceId,
      toolName: member.record.toolName || "unknown",
      taxonomyId,
      output: (member.record.output || "").slice(0, 240),
      similarity: round(cluster.similarities[index] ?? 1),
    };
  });
  const label = deriveLabel(cluster.members);
  const suggestion = deriveSuggestion(cluster.members);
  return {
    id: `cluster-${sha256String(cluster.members.map((member) => member.text).join("\n")).slice(0, 12)}`,
    label,
    size: cluster.members.length,
    confidence: round(average(cluster.similarities)),
    taxonomyCounts,
    tools: [...tools].sort(),
    ...(suggestion.suggestedFix ? { suggestedFix: suggestion.suggestedFix } : {}),
    ...(suggestion.autoFix ? { autoFix: suggestion.autoFix } : {}),
    members,
  };
}

function deriveLabel(members: EmbeddedFailure[]): string {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const token of tokenize(member.text)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .filter(([token]) => !token.includes("_"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([token]) => token);
  return top.length > 0 ? top.join(" ") : "unclassified failure";
}

function deriveSuggestion(members: EmbeddedFailure[]): { suggestedFix?: string; autoFix?: string } {
  const known = members
    .map(
      (member) => member.record as FailureTraceRecord & { suggestion?: string; autoFix?: string }
    )
    .find((record) => record.suggestion || record.autoFix);
  if (known?.suggestion || known?.autoFix) {
    return {
      suggestedFix: known.suggestion,
      autoFix: known.autoFix,
    };
  }
  const taxonomyIds = members.map((member) => member.record.taxonomyId || member.record.categoryId);
  if (taxonomyIds.every((id) => id === "unknown")) {
    return {
      suggestedFix: "Review this cluster and add a taxonomy rule or healing playbook.",
    };
  }
  return {};
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, " uuid ")
    .replace(/[0-9a-f]{32,}/g, " hash ")
    .replace(/\/[^\s"'`]+/g, " path ")
    .replace(
      /\b\d+(\.\d+)?\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/g,
      " duration "
    )
    .replace(/\b\d+(\.\d+)?\b/g, " number ")
    .replace(/timed\s*out|timeout/g, " timeout ")
    .replace(/waiting|waited/g, " wait ")
    .replace(/not\s+found|missing/g, " missing ")
    .replace(/permission\s+denied|forbidden|unauthorized/g, " permission ")
    .replace(/[^a-z0-9_]+/g, " ");
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
