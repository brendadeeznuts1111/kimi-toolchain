/**
 * Local 384-dim embeddings for failure ledger clustering.
 *
 * Uses @xenova/transformers MiniLM when available; falls back to a pure-JS
 * feature-hash embedder (no network, instant load).
 */

import { Effect } from "effect";

export const MINILM_MODEL = "Xenova/all-MiniLM-L6-v2";

export interface Embedder {
  name: "minilm" | "hash";
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

let cachedEmbedder: Embedder | null = null;

export function embeddingToBase64(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64");
}

export function embeddingFromBase64(encoded: string): Float32Array {
  const buf = Buffer.from(encoded, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function loadEmbedderEffect(): Effect.Effect<Embedder, never> {
  return Effect.tryPromise({
    try: () => getEmbedder(),
    catch: () => new Error("embedder-load-failed"),
  }).pipe(Effect.catchAll(() => Effect.succeed(createHashEmbedder())));
}

export async function getEmbedder(): Promise<Embedder> {
  if (cachedEmbedder) return cachedEmbedder;
  if (Bun.env.KIMI_EMBEDDER === "hash") {
    cachedEmbedder = createHashEmbedder();
    return cachedEmbedder;
  }
  try {
    cachedEmbedder = await createMiniLmEmbedder();
    return cachedEmbedder;
  } catch {
    cachedEmbedder = createHashEmbedder();
    return cachedEmbedder;
  }
}

export function buildEmbeddableText(input: {
  output?: string;
  taxonomyId?: string;
  categoryId?: string;
  toolName?: string;
  stepDescription?: string;
  causalChain?: string[];
  environment?: Record<string, string>;
}): string {
  const parts = [
    (input.output || "").slice(0, 512),
    input.stepDescription ? `step: ${input.stepDescription}` : "",
    input.taxonomyId || input.categoryId ? `taxonomy:${input.taxonomyId || input.categoryId}` : "",
    input.toolName ? `tool:${input.toolName}` : "",
    ...(input.causalChain || []).map((step) => `cause: ${step}`),
    input.environment
      ? `env: ${Object.entries(input.environment)
          .slice(0, 8)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function createHashEmbedder(): Embedder {
  return {
    name: "hash",
    embed: async (text) => hashEmbed384(text),
    embedBatch: async (texts) => texts.map((text) => hashEmbed384(text)),
  };
}

async function createMiniLmEmbedder(): Promise<Embedder> {
  const transformersPackage = "@xenova/transformers";
  const { pipeline } = (await import(transformersPackage)) as {
    pipeline: (
      task: string,
      model: string,
      options: { quantized: boolean }
    ) => Promise<
      (
        text: string,
        options: { pooling: string; normalize: boolean }
      ) => Promise<{
        data: Float32Array | number[];
      }>
    >;
  };
  const started = performance.now();
  const extractor = await pipeline("feature-extraction", MINILM_MODEL, {
    quantized: true,
  });
  if (performance.now() - started > 2000) {
    throw new Error("MiniLM load exceeded 2s budget");
  }

  const embedOne = async (text: string): Promise<Float32Array> => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const data = output.data as Float32Array | number[];
    const vec = data instanceof Float32Array ? data : new Float32Array(data);
    if (vec.length !== KIMI_ERROR_EMBEDDING_DIM) {
      return resizeVector(vec, KIMI_ERROR_EMBEDDING_DIM);
    }
    return l2Normalize(vec);
  };

  return {
    name: "minilm",
    embed: embedOne,
    embedBatch: async (texts) => {
      const results: Float32Array[] = [];
      for (const text of texts) {
        results.push(await embedOne(text));
      }
      return results;
    },
  };
}

export function hashEmbed384(text: string): Float32Array {
  const vec = new Float32Array(KIMI_ERROR_EMBEDDING_DIM);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const h = fnv1a(token) % KIMI_ERROR_EMBEDDING_DIM;
    vec[h] += 1;
    const h2 = fnv1a(`${token}#`) % KIMI_ERROR_EMBEDDING_DIM;
    vec[h2] += 0.5;
  }
  for (let index = 0; index < tokens.length - 1; index++) {
    const bigram = `${tokens[index]}_${tokens[index + 1]}`;
    const h = fnv1a(bigram) % KIMI_ERROR_EMBEDDING_DIM;
    vec[h] += 1.5;
  }
  return l2Normalize(vec);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let index = 0; index < len; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, " uuid ")
    .replace(/[^a-z0-9_\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let index = 0; index < vector.length; index++) norm += vector[index] * vector[index];
  if (norm === 0) return vector;
  const scale = 1 / Math.sqrt(norm);
  for (let index = 0; index < vector.length; index++) vector[index] *= scale;
  return vector;
}

function resizeVector(source: Float32Array, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let index = 0; index < dim; index++) {
    out[index] = source[index % source.length];
  }
  return l2Normalize(out);
}

export function resetEmbedderCache(): void {
  cachedEmbedder = null;
}
