/**
 * Bun v1.3.7 "Faster JavaScript Built-ins" regression test.
 *
 * String methods (isWellFormed/toWellFormed) 5.2-5.4x faster via simdutf.
 * RegExp methods (matchAll/replace) reimplemented in C++.
 */
import { describe, expect, test } from "bun:test";

describe("js-builtins-performance", () => {
  test("String.prototype.isWellFormed returns true for ASCII", () => {
    const s = "hello world";
    expect(s.isWellFormed()).toBe(true);
  });

  test("String.prototype.isWellFormed detects lone surrogate", () => {
    const s = "a\uD800b";
    expect(s.isWellFormed()).toBe(false);
  });

  test("String.prototype.toWellFormed replaces lone surrogate with U+FFFD", () => {
    const s = "a\uD800b";
    const fixed = s.toWellFormed();
    expect(fixed).not.toBe(s);
    expect(fixed.isWellFormed()).toBe(true);
    expect(fixed).toBe("a\uFFFDb");
  });

  test("String.prototype.toWellFormed on already-valid string returns same value", () => {
    const s = "hello";
    expect(s.toWellFormed()).toBe(s);
  });

  test("RegExp matchAll works correctly", () => {
    const matches = [..."a1b2c3".matchAll(/([a-z])(\d)/g)];
    expect(matches.length).toBe(3);
    expect(matches[0]?.[1]).toBe("a");
    expect(matches[0]?.[2]).toBe("1");
  });

  test("RegExp replace with function callback", () => {
    const result = "a1b2".replace(/([a-z])(\d)/g, (_, l, d) => d + l);
    expect(result).toBe("1a2b");
  });
});

describe("js-builtins-throughput", () => {
  test("isWellFormed on 1MB ASCII completes under 1ms (simdutf)", () => {
    const s = "x".repeat(1_000_000);
    const start = Bun.nanoseconds();
    const result = s.isWellFormed();
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    console.log(`  isWellFormed 1MB: ${elapsed.toFixed(2)} ms (simdutf, ~5x faster)`);
    expect(result).toBe(true);
    expect(elapsed).toBeLessThan(1);
  });

  test("toWellFormed on 1MB ASCII completes under 1ms (simdutf)", () => {
    const s = "x".repeat(1_000_000);
    const start = Bun.nanoseconds();
    const result = s.toWellFormed();
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    console.log(`  toWellFormed 1MB: ${elapsed.toFixed(2)} ms (simdutf, ~5x faster)`);
    expect(result).toBe(s);
    expect(elapsed).toBeLessThan(1);
  });

  test("matchAll on 100K matches completes under 50ms (C++ backend)", () => {
    const s = "a1".repeat(100_000);
    const re = /(a)(\d)/g;
    const start = Bun.nanoseconds();
    const count = [...s.matchAll(re)].length;
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    console.log(`  matchAll 100K: ${elapsed.toFixed(0)} ms (C++ backend)`);
    expect(count).toBe(100_000);
    expect(elapsed).toBeLessThan(50);
  });

  test("replace on 100K matches completes under 50ms (C++ backend)", () => {
    const s = "a1".repeat(100_000);
    const start = Bun.nanoseconds();
    const result = s.replace(/a/g, "b");
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    console.log(`  replace 100K: ${elapsed.toFixed(0)} ms (C++ backend)`);
    expect(result).toBe("b1".repeat(100_000));
    expect(elapsed).toBeLessThan(50);
  });
});
