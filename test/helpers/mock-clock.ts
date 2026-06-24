/**
 * bun:test mock-clock helpers for time-dependent tests.
 *
 * | Use case              | Avoid                         | Prefer                                      |
 * |-----------------------|-------------------------------|---------------------------------------------|
 * | Token expiry          | Date.now() offset / real wait | setSystemTime(afterExpiry) + verify reject  |
 * | Cron / wall-clock     | Real sleep                    | setSystemTime(future) or test handler direct|
 * | Session / TTL cache   | Bun.sleep(ttl)                | setSystemTime(afterTTL) + verify eviction   |
 * | Snapshot timestamps   | Stub Date.now                 | setSystemTime(fixed) + deterministic output |
 * | Audit log ordering    | Parallel real-time drift      | setSystemTime(increment) per record         |
 * | Deadline polling      | while (Date.now() < deadline) | pollUntil + setSystemTime on sleep inject   |
 *
 * Bun.sleep loops: jest.useFakeTimers() + jest.advanceTimersByTime(ms).
 * Bun.CSRF.verify: real wall clock only (use await Bun.sleep, not setSystemTime).
 *
 * @see https://bun.com/guides/test/mock-clock
 * @see test/bun-set-system-time.unit.test.ts
 * @see test/bun-tz-runtime.unit.test.ts
 * @see test/token-auth.unit.test.ts — full TTL boundary example
 */

import { setSystemTime } from "bun:test";

export const MOCK_CLOCK_EPOCH = new Date("2026-06-23T10:00:00.000Z");

/** Run fn with a fixed wall clock; always resets with setSystemTime(). */
export async function withSystemTime<T>(at: Date, fn: () => T | Promise<T>): Promise<T> {
  setSystemTime(at);
  try {
    return await fn();
  } finally {
    setSystemTime();
  }
}

/** Advance the mocked wall clock by `deltaMs` from the current mocked instant. */
export function advanceSystemTime(deltaMs: number, from = Date.now()): void {
  setSystemTime(new Date(from + deltaMs));
}

/** UTC second floor for JWT iat/exp/nbf claims aligned to mocked wall clock. */
export function utcSeconds(from = Date.now()): number {
  return Math.floor(from / 1000);
}
