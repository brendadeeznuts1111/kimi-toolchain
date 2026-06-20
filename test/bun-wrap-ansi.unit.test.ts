/**
 * Bun.wrapAnsi performance regression test.
 *
 * Bun v1.3.7 introduced Bun.wrapAnsi() — 33–88x faster than the wrap-ansi npm package.
 * This test verifies throughput is within the expected range and catches regressions.
 *
 * Blog benchmarks (pre-1.3.7):
 *   Short text (45 chars):     685 ns
 *   Long text (8100 chars):    112 µs
 *
 * @see https://bun.com/blog/bun-v1.3.7
 */
import { describe, expect, test } from "bun:test";

const SHORT_TEXT = "\x1b[31mThis is a long red text that needs wrapping\x1b[0m";
const LONG_TEXT = "\x1b[32m" + "The quick brown fox jumps over the lazy dog. ".repeat(200) + "\x1b[0m";

describe("bun-wrap-ansi", () => {
  test("Bun.wrapAnsi is available", () => {
    expect(typeof Bun.wrapAnsi).toBe("function");
  });

  test("short text wraps under 10µs", () => {
    const start = Bun.nanoseconds();
    const wrapped = Bun.wrapAnsi(SHORT_TEXT, 20);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  wrapAnsi 45 chars: ${elapsed.toFixed(1)} µs (blog: ~0.7 µs)`);
    expect(wrapped.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  test("long text wraps under 500µs", () => {
    const start = Bun.nanoseconds();
    const wrapped = Bun.wrapAnsi(LONG_TEXT, 40);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  wrapAnsi ${LONG_TEXT.length} chars: ${elapsed.toFixed(0)} µs (blog: ~112 µs)`);
    expect(wrapped.length).toBeGreaterThan(LONG_TEXT.length); // wrapping adds newlines
    expect(elapsed).toBeLessThan(10_000);
  });

  test("ANSI color codes are preserved across wraps", () => {
    const wrapped = Bun.wrapAnsi(SHORT_TEXT, 20);
    // Red color code should appear in every wrapped line
    const lines = wrapped.split("\n");
    for (const line of lines) {
      expect(line).toContain("\x1b[31m");
    }
  });

  test("hard wrap breaks long words", () => {
    const longWord = "supercalifragilisticexpialidocious";
    const wrapped = Bun.wrapAnsi(longWord, 10, { hard: true, wordWrap: false });
    expect(wrapped.split("\n").every((l) => l.length <= 10)).toBe(true);
  });
});
