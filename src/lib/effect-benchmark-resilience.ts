/**
 * effect-benchmark-resilience.ts — Rate limiting and API error helpers for dashboard POST routes.
 */

import type { EffectBenchmarkCardPayload } from "./effect-benchmark-card.ts";

const postCooldownByRoute = new Map<string, number>();

export function formatBenchmarkError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function checkBenchmarkPostCooldown(
  route: string,
  cooldownMs = KIMI_EFFECT_BENCHMARK_POST_COOLDOWN_MS
): { allowed: boolean; retryAfterMs: number } {
  const last = postCooldownByRoute.get(route) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < cooldownMs) {
    return { allowed: false, retryAfterMs: cooldownMs - elapsed };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function markBenchmarkPost(route: string): void {
  postCooldownByRoute.set(route, Date.now());
}

/** Test-only: reset in-memory cooldown state. */
export function resetBenchmarkPostCooldown(): void {
  postCooldownByRoute.clear();
}

export interface BenchmarkApiEnvelope extends EffectBenchmarkCardPayload {
  ok: boolean;
  partialSuccess?: boolean;
  timedOut?: boolean;
  errors?: Array<{ registryKey: string; message: string }>;
  requestError?: string;
  lastSuccessfulAt?: string;
  retryAfterMs?: number;
}

export function benchmarkRateLimitEnvelope(
  retryAfterMs: number,
  lastSuccessful: EffectBenchmarkCardPayload | null,
  lastSuccessfulAt: string | null
): BenchmarkApiEnvelope {
  const base: BenchmarkApiEnvelope = {
    ok: false,
    requestError: `Rate limited — retry in ${Math.ceil(retryAfterMs / 1000)}s`,
    retryAfterMs,
    lastSuccessfulAt: lastSuccessfulAt ?? undefined,
    generatedAt: new Date().toISOString(),
    allPass: false,
    registrySize: 0,
    measured: 0,
    skipped: 0,
    failures: [],
    families: {},
    metrics: [],
    recentRuns: [],
    thresholdLayers: [],
    snapshot: { count: 0, regressions: 0, regressionKeys: [] },
    philosophy: "",
  };

  if (lastSuccessful) {
    return {
      ...lastSuccessful,
      ok: false,
      requestError: base.requestError,
      retryAfterMs,
      lastSuccessfulAt: lastSuccessfulAt ?? lastSuccessful.generatedAt,
    };
  }

  return base;
}

export function benchmarkErrorEnvelope(
  requestError: string,
  lastSuccessful: EffectBenchmarkCardPayload | null,
  lastSuccessfulAt: string | null
): BenchmarkApiEnvelope {
  if (lastSuccessful) {
    return {
      ...lastSuccessful,
      ok: false,
      requestError,
      lastSuccessfulAt: lastSuccessfulAt ?? lastSuccessful.generatedAt,
    };
  }

  return {
    ok: false,
    requestError,
    lastSuccessfulAt: lastSuccessfulAt ?? undefined,
    generatedAt: new Date().toISOString(),
    allPass: false,
    registrySize: 0,
    measured: 0,
    skipped: 0,
    failures: [],
    families: {},
    metrics: [],
    recentRuns: [],
    thresholdLayers: [],
    snapshot: { count: 0, regressions: 0, regressionKeys: [] },
    philosophy: "",
  };
}

export function benchmarkSuccessEnvelope(
  payload: EffectBenchmarkCardPayload,
  resilience: {
    partialSuccess?: boolean;
    timedOut?: boolean;
    errors?: Array<{ registryKey: string; message: string }>;
  }
): BenchmarkApiEnvelope {
  return {
    ok: true,
    partialSuccess: resilience.partialSuccess,
    timedOut: resilience.timedOut,
    errors: resilience.errors?.length ? resilience.errors : undefined,
    ...payload,
  };
}