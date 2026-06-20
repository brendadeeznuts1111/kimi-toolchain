/**
 * effect-benchmark-resilience.ts — Rate limiting helpers for dashboard POST routes.
 */

import type { BenchmarkApiEnvelope } from "./effect-benchmark-card.ts";
import {
  benchmarkErrorApiEnvelope,
  getLastGoodBenchmarkAt,
  getLastGoodBenchmarkEnvelope,
  type EffectBenchmarkCardPayload,
} from "./effect-benchmark-card.ts";

const postCooldownByRoute = new Map<string, number>();

export type { BenchmarkApiEnvelope } from "./effect-benchmark-card.ts";
export { benchmarkErrorApiEnvelope } from "./effect-benchmark-card.ts";

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

export function benchmarkRateLimitEnvelope(retryAfterMs: number): BenchmarkApiEnvelope {
  return benchmarkErrorApiEnvelope(`Rate limited — retry in ${Math.ceil(retryAfterMs / 1000)}s`, {
    retryAfterMs,
  });
}

/** @deprecated Use benchmarkErrorApiEnvelope from effect-benchmark-card.ts */
export function benchmarkErrorEnvelope(
  requestError: string,
  _lastSuccessful: EffectBenchmarkCardPayload | null,
  _lastSuccessfulAt: string | null
): BenchmarkApiEnvelope {
  return benchmarkErrorApiEnvelope(requestError);
}

/** @deprecated Loop returns BenchmarkApiEnvelope directly */
export function benchmarkSuccessEnvelope(
  payload: EffectBenchmarkCardPayload,
  _resilience: {
    partialSuccess?: boolean;
    timedOut?: boolean;
    errors?: Array<{ registryKey: string; message: string }>;
  }
): BenchmarkApiEnvelope {
  void payload;
  void _resilience;
  return getLastGoodBenchmarkEnvelope() ?? benchmarkErrorApiEnvelope("envelope unavailable");
}
