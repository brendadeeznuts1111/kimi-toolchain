/**
 * Local 384-dim text embeddings for failure clustering.
 *
 * Uses deterministic feature hashing (signed random projection) — no model
 * download, no external API, loads instantly in Bun. Dimension matches
 * all-MiniLM-L6-v2 for downstream compatibility.
 */

import type { FailureTraceRecord, TraceEvent } from "./trace-ledger.ts";

export const EMBEDDING_DIM = KIMI_ERROR_EMBEDDING_DIM;

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

/** Build a text representation suitable for embedding. */
export function buildEmbeddingText(record: FailureTraceRecord, traces: TraceEvent[]): string {
  const message = (record.output || "").slice(0, 512);
  const taxonomy = record.taxonomyId || record.categoryId || "unknown";
  const chain = describeCausalChain(record, traces);
  const stepDesc = describeFailingStep(record, traces);
  return [message, stepDesc, `taxonomy:${taxonomy}`, chain].filter(Boolean).join("\n");
}

export function embedText(text: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIM);
  for (const feature of extractFeatures(text)) {
    const index = feature.index % EMBEDDING_DIM;
    vector[index] += feature.sign * feature.weight;
  }
  return l2Normalize(vector);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeEmbedding(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  return btoa(String.fromCharCode(...bytes));
}

export function decodeEmbedding(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function embedFailure(
  record: FailureTraceRecord,
  traces: TraceEvent[]
): { text: string; vector: Float32Array } {
  const text = buildEmbeddingText(record, traces);
  return { text, vector: embedText(text) };
}

function describeFailingStep(record: FailureTraceRecord, traces: TraceEvent[]): string {
  const events = traces.filter((event) => event.traceId === record.traceId);
  if (events.length === 0) return record.toolName ? `tool:${record.toolName}` : "";
  const event = events.find((item) => item.status === "error") ?? events[events.length - 1];
  const command = event.command?.join(" ") ?? "";
  return [event.tool, event.eventType, command].filter(Boolean).join(" ");
}

function describeCausalChain(record: FailureTraceRecord, traces: TraceEvent[]): string {
  const chain: string[] = [];
  let current = record.parentTraceId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = traces.find((event) => event.traceId === current);
    if (!parent) break;
    const desc = [parent.tool, parent.eventType, parent.error?.slice(0, 120)]
      .filter(Boolean)
      .join(" ");
    if (desc) chain.push(desc);
    current = parent.parentTraceId;
  }
  return chain.length > 0 ? `chain:${chain.join(" -> ")}` : "";
}

interface Feature {
  index: number;
  sign: number;
  weight: number;
}

function extractFeatures(text: string): Feature[] {
  const normalized = normalize(text);
  const features: Feature[] = [];
  for (const token of tokenize(normalized)) {
    features.push(hashFeature(`w:${token}`, 1));
  }
  for (let i = 0; i < normalized.length - 2; i++) {
    features.push(hashFeature(`c:${normalized.slice(i, i + 3)}`, 0.5));
  }
  for (let i = 0; i < tokenize(normalized).length - 1; i++) {
    const tokens = tokenize(normalized);
    features.push(hashFeature(`b:${tokens[i]}_${tokens[i + 1]}`, 1.5));
  }
  return features;
}

function hashFeature(key: string, weight: number): Feature {
  const hash = BigInt(Bun.hash(key));
  const index = Number(hash & 0xffffffffn);
  const sign = (hash >> 32n) & 1n ? 1 : -1;
  return { index, sign, weight };
}

function tokenize(text: string): string[] {
  return text
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
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  if (norm === 0) return vector;
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) vector[i] *= scale;
  return vector;
}
