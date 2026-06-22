/**
 * timing.ts — canonical timing helpers (ms wall clock + TTL expiry).
 */

/** Minimum meaningful delta for performance.now() (sub-ms ops need Bun.nanoseconds). */
export const MIN_PERF_NOW_MS = 1;

export function nowMs(): number {
  return performance.now();
}

export function isExpired(sinceMs: number, ttlMs: number): boolean {
  return nowMs() - sinceMs >= ttlMs;
}
