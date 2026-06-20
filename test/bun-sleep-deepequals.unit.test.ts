/**
 * Bun.sleep and Bun.deepEquals correctness tests.
 */
import { describe, expect, test } from "bun:test";

describe("bun-sleep", () => {
  test("Bun.sleep resolves after delay", async () => {
    const start = Bun.nanoseconds();
    await Bun.sleep(50);
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe("bun-deep-equals", () => {
  test("deepEquals matches identical objects", () => {
    expect(Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true);
    expect(Bun.deepEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("deepMatch partial subset (partial ⊆ actual)", () => {
    // Bun.deepMatch(partial, actual) — true when partial is a subset of actual
    expect(Bun.deepMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(Bun.deepMatch({ a: 1 }, { a: 2 })).toBe(false);
    expect(Bun.deepMatch({ a: 1 }, { b: 2 })).toBe(false);
  });
});
