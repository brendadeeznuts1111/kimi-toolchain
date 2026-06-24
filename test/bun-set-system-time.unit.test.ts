/**
 * bun:test setSystemTime — mirrors official mock-clock guide.
 *
 * Controls Date.now(), new Date(), and Intl formatting (not timers by itself).
 * Pair with jest.useFakeTimers() when testing Bun.sleep loops.
 *
 * @see https://bun.com/guides/test/mock-clock
 * @see https://bun.sh/docs/test/dates-times
 */

import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";

describe("bun-set-system-time", () => {
  afterEach(() => {
    setSystemTime(); // reset to actual time
  });

  test("party like it's 1999", () => {
    const date = new Date("1999-01-01T00:00:00.000Z");
    setSystemTime(date); // it's now January 1, 1999

    const now = new Date();
    expect(now.getFullYear()).toBe(1999);
    expect(now.getMonth()).toBe(0);
    expect(now.getDate()).toBe(1);
  });

  test("setSystemTime() with no arguments resets to actual time", () => {
    setSystemTime(new Date("1999-01-01T00:00:00.000Z"));
    expect(new Date().getFullYear()).toBe(1999);

    setSystemTime(); // reset to actual time
    expect(new Date().getFullYear()).toBeGreaterThan(1999);
  });
});

describe("bun:test setSystemTime with beforeAll lifecycle hook", () => {
  beforeAll(() => {
    const date = new Date("1999-01-01T00:00:00.000Z");
    setSystemTime(date); // it's now January 1, 1999
  });

  afterAll(() => {
    setSystemTime(); // reset to actual time
  });

  test("Date.now reflects the beforeAll fake clock", () => {
    expect(new Date().getFullYear()).toBe(1999);
    expect(new Date().getMonth()).toBe(0);
    expect(new Date().getDate()).toBe(1);
  });

  test("subsequent tests in the same describe share the fake clock", () => {
    const now = new Date();
    expect(now.getFullYear()).toBe(1999);
    expect(now.getMonth()).toBe(0);
    expect(now.getDate()).toBe(1);
  });
});
