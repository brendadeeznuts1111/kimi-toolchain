/**
 * timing.ts — canonical timing helpers aligned with Bun benchmarking docs.
 * @see https://bun.com/docs/project/benchmarking#measuring-time
 */

/** Minimum meaningful delta for millisecond-scale timing (sub-ms ops use Bun.nanoseconds). */
export const MIN_PERF_NOW_MS = 1;

export const NS_PER_MS = 1_000_000;

export function nowMs(): number {
  return nsToMs(Bun.nanoseconds());
}

/** High-resolution monotonic clock (nanoseconds since process start). */
export function nowNs(): number {
  return Bun.nanoseconds();
}

export function nsToMs(ns: number): number {
  return ns / NS_PER_MS;
}

export function elapsedMs(startNs: number): number {
  return nsToMs(Bun.nanoseconds() - startNs);
}

export function isExpired(sinceMs: number, ttlMs: number): boolean {
  return nowMs() - sinceMs >= ttlMs;
}
