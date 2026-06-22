/**
 * Performance gate — timed profile capture with slow-path warnings.
 */

export const PERF_GATE_SLOW_MS = 1000;

export interface ProfileCapture<T> {
  result: T;
  durationMs: number;
  slow: boolean;
}

/** Run `fn`, return result + duration; marks slow when over {@link PERF_GATE_SLOW_MS}. */
export async function captureProfile<T>(
  name: string,
  fn: () => Promise<T> | T,
  slowMs = PERF_GATE_SLOW_MS
): Promise<ProfileCapture<T>> {
  const start = Bun.nanoseconds();
  const result = await fn();
  const durationMs = (Bun.nanoseconds() - start) / 1e6;
  const slow = durationMs > slowMs;
  if (slow) {
    Bun.stderr.write(`[perf-gate] slow ${name}: ${durationMs.toFixed(1)}ms (>${slowMs}ms)\n`);
  }
  return { result, durationMs, slow };
}
