/**
 * Canonical mock-clock patterns for time-dependent production code.
 *
 * @see test/helpers/mock-clock.ts
 */

import { describe, expect, jest, setSystemTime, test } from "bun:test";
import { TtlCache } from "../src/lib/cache.ts";
import { verifyJwt, signJwt } from "../src/lib/jwt.ts";
import {
  MOCK_CLOCK_EPOCH,
  advanceSystemTime,
  utcSeconds,
  withSystemTime,
} from "./helpers/mock-clock.ts";

const JWT_SECRET = "mock-clock-pattern-secret";

describe("bun-mock-clock-patterns", () => {
  test("token expiry: setSystemTime after exp verifies rejection", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      const token = signJwt({ sub: "user1" }, JWT_SECRET, { ttlSeconds: 60 });
      expect(() => verifyJwt(token, JWT_SECRET)).not.toThrow();

      advanceSystemTime(61_000, MOCK_CLOCK_EPOCH.getTime());
      expect(() => verifyJwt(token, JWT_SECRET)).toThrow();
    });
  });

  test("session TTL: setSystemTime after ttl evicts cache entry", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      const cache = new TtlCache<string>({ ttlMs: 40 });
      cache.set("session", "active");
      expect(cache.get("session")).toBe("active");

      advanceSystemTime(50, MOCK_CLOCK_EPOCH.getTime());
      expect(cache.get("session")).toBeUndefined();
    });
  });

  test("snapshot timestamp: setSystemTime yields deterministic id suffix", async () => {
    const fixed = new Date("2026-01-15T12:00:00.000Z");
    await withSystemTime(fixed, async () => {
      expect(`snap-${Date.now()}`).toBe(`snap-${fixed.getTime()}`);
    });
  });

  test("audit log ordering: increment setSystemTime preserves strict order", async () => {
    const records: string[] = [];
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      for (let i = 0; i < 3; i++) {
        records.push(new Date().toISOString());
        advanceSystemTime(1000, MOCK_CLOCK_EPOCH.getTime() + i * 1000);
      }
    });
    expect(records).toEqual([
      "2026-06-23T10:00:00.000Z",
      "2026-06-23T10:00:01.000Z",
      "2026-06-23T10:00:02.000Z",
    ]);
  });

  test("cron handler: test tick directly (wall clock optional)", () => {
    let pruned = 0;
    const pruneExpired = () => {
      pruned += 1;
    };
    pruneExpired();
    expect(pruned).toBe(1);
  });

  test("Bun.sleep loop: jest.advanceTimersByTime flushes interval", async () => {
    jest.useFakeTimers();
    try {
      let ticks = 0;
      void (async () => {
        await Bun.sleep(5000);
        ticks += 1;
      })();
      expect(ticks).toBe(0);
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(ticks).toBe(1);
    } finally {
      jest.useRealTimers();
      setSystemTime();
    }
  });

  test("utcSeconds aligns JWT claims to mocked clock", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      expect(utcSeconds()).toBe(Math.floor(MOCK_CLOCK_EPOCH.getTime() / 1000));
    });
  });
});
