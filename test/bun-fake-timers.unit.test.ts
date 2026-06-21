/**
 * Bun v1.3.4 Fake Timers for bun:test.
 *
 * Validates the jest fake timer API:
 * - useFakeTimers / useRealTimers
 * - advanceTimersByTime
 * - advanceTimersToNextTimer
 * - runAllTimers / runOnlyPendingTimers
 * - getTimerCount / clearAllTimers
 * - isFakeTimers
 *
 * @see https://bun.com/blog/bun-v1.3.4#fake-timers-for-buntest
 */

import { describe, expect, jest, test } from "bun:test";

// ── useFakeTimers / useRealTimers ────────────────────────────────────

describe("bun-fake-timers useFakeTimers / useRealTimers", () => {
  test("useFakeTimers does not throw", () => {
    expect(() => jest.useFakeTimers()).not.toThrow();
    jest.useRealTimers();
  });

  test("useFakeTimers with { now } option sets initial time", () => {
    jest.useFakeTimers({ now: 1000 });
    expect(jest.isFakeTimers()).toBe(true);
    jest.useRealTimers();
  });

  test("useFakeTimers with Date object", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    jest.useFakeTimers({ now: date });
    expect(jest.isFakeTimers()).toBe(true);
    jest.useRealTimers();
  });

  test("isFakeTimers returns true after useFakeTimers", () => {
    jest.useFakeTimers();
    expect(jest.isFakeTimers()).toBe(true);
    jest.useRealTimers();
  });

  test("isFakeTimers returns false after useRealTimers", () => {
    jest.useFakeTimers();
    jest.useRealTimers();
    expect(jest.isFakeTimers()).toBe(false);
  });
});

// ── advanceTimersByTime ──────────────────────────────────────────────

describe("bun:test fake timers — advanceTimersByTime", () => {
  test("advances time and fires setTimeout callback", () => {
    jest.useFakeTimers();
    let called = false;
    setTimeout(() => {
      called = true;
    }, 1000);
    expect(called).toBe(false);
    jest.advanceTimersByTime(1000);
    expect(called).toBe(true);
    jest.useRealTimers();
  });

  test("does not fire callback before time is advanced", () => {
    jest.useFakeTimers();
    let called = false;
    setTimeout(() => {
      called = true;
    }, 5000);
    jest.advanceTimersByTime(1000);
    expect(called).toBe(false);
    jest.useRealTimers();
  });

  test("advances time partially then fully", () => {
    jest.useFakeTimers();
    let count = 0;
    setTimeout(() => {
      count++;
    }, 3000);
    jest.advanceTimersByTime(1000);
    expect(count).toBe(0);
    jest.advanceTimersByTime(2000);
    expect(count).toBe(1);
    jest.useRealTimers();
  });

  test("advances time fires setInterval callbacks repeatedly", () => {
    jest.useFakeTimers();
    let count = 0;
    const id = setInterval(() => {
      count++;
    }, 1000);
    jest.advanceTimersByTime(5000);
    expect(count).toBe(5);
    clearInterval(id);
    jest.useRealTimers();
  });
});

// ── advanceTimersToNextTimer ─────────────────────────────────────────

describe("bun:test fake timers — advanceTimersToNextTimer", () => {
  test("advances to the next scheduled timer", () => {
    jest.useFakeTimers();
    let called = false;
    setTimeout(() => {
      called = true;
    }, 5000);
    jest.advanceTimersToNextTimer();
    expect(called).toBe(true);
    jest.useRealTimers();
  });
});

// ── runAllTimers ─────────────────────────────────────────────────────

describe("bun:test fake timers — runAllTimers", () => {
  test("runs all pending timers including nested", () => {
    jest.useFakeTimers();
    let count = 0;
    setTimeout(() => {
      count++;
      setTimeout(() => {
        count++;
      }, 1000);
    }, 1000);
    jest.runAllTimers();
    expect(count).toBe(2);
    jest.useRealTimers();
  });
});

// ── runOnlyPendingTimers ─────────────────────────────────────────────

describe("bun:test fake timers — runOnlyPendingTimers", () => {
  test("runs only currently pending timers (not nested)", () => {
    jest.useFakeTimers();
    let count = 0;
    setTimeout(() => {
      count++;
      setTimeout(() => {
        count++;
      }, 1000);
    }, 1000);
    jest.runOnlyPendingTimers();
    expect(count).toBe(1);
    jest.useRealTimers();
  });
});

// ── getTimerCount ────────────────────────────────────────────────────

describe("bun:test fake timers — getTimerCount", () => {
  test("returns 0 when no timers are pending", () => {
    jest.useFakeTimers();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  test("returns count of pending timers", () => {
    jest.useFakeTimers();
    setTimeout(() => {}, 1000);
    setTimeout(() => {}, 2000);
    expect(jest.getTimerCount()).toBe(2);
    jest.useRealTimers();
  });
});

// ── clearAllTimers ───────────────────────────────────────────────────

describe("bun:test fake timers — clearAllTimers", () => {
  test("clears all pending timers", () => {
    jest.useFakeTimers();
    setTimeout(() => {}, 1000);
    setTimeout(() => {}, 2000);
    expect(jest.getTimerCount()).toBe(2);
    jest.clearAllTimers();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  test("cleared timers do not fire", () => {
    jest.useFakeTimers();
    let called = false;
    setTimeout(() => {
      called = true;
    }, 1000);
    jest.clearAllTimers();
    jest.advanceTimersByTime(2000);
    expect(called).toBe(false);
    jest.useRealTimers();
  });
});

// ── Integration: Date with fake timers ───────────────────────────────

describe("bun:test fake timers — Date integration", () => {
  test("Date.now returns fake time after useFakeTimers with now", () => {
    const fixedTime = 1700000000000;
    jest.useFakeTimers({ now: fixedTime });
    expect(Date.now()).toBe(fixedTime);
    jest.useRealTimers();
  });

  test("Date advances with advanceTimersByTime", () => {
    const start = 1700000000000;
    jest.useFakeTimers({ now: start });
    jest.advanceTimersByTime(5000);
    expect(Date.now()).toBe(start + 5000);
    jest.useRealTimers();
  });
});
