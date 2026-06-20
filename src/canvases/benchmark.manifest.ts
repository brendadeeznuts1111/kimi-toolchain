/**
 * benchmark canvas manifest — highlights effect-benchmark cards on deep links.
 * Companion IDE surface: docs/canvases/benchmark.canvas.tsx
 */

export const BENCHMARK_MANIFEST_ID = "benchmark";

/** Cards highlighted when ?canvas=benchmark. */
export const BENCHMARK_CARD_IDS = [
  "card-effect-benchmark",
  "card-perf-harness",
  "card-kimi-doctor",
] as const;

export type BenchmarkCardId = (typeof BENCHMARK_CARD_IDS)[number];

/** URLPattern for benchmark deep links (search params). */
export const BENCHMARK_URL_PATTERN = new URLPattern({
  search: "canvas=benchmark",
});

export const benchmarkManifest = {
  id: BENCHMARK_MANIFEST_ID,
  canvasId: BENCHMARK_MANIFEST_ID,
  cardIds: BENCHMARK_CARD_IDS,
  urlPattern: BENCHMARK_URL_PATTERN,
} as const;
