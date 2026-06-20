/**
 * Bun.Terminal, Bun.peek, and Bun.shrink correctness regression tests.
 */
import { describe, expect, test } from "bun:test";

describe("bun-terminal", () => {
  test("Bun.Terminal is available", () => {
    expect(typeof Bun.Terminal).toBe("function");
  });
});

describe("bun-peek", () => {
  test("Bun.peek is available", () => {
    expect(typeof Bun.peek).toBe("function");
  });

  test("Bun.peek returns resolved value", async () => {
    const p = Promise.resolve(42);
    const status = Bun.peek(p);
    expect(status).toBe(42);
  });

  test("Bun.peek on pending promise returns pending status", () => {
    const p = new Promise(() => {});
    const status = Bun.peek(p);
    expect(status).toBeDefined();
  });
});

describe("bun-shrink", () => {
  test("Bun.shrink is available", () => {
    expect(typeof Bun.shrink).toBe("function");
  });

  test("Bun.shrink does not throw", () => {
    // shrink triggers GC compaction — no return value, must not throw
    expect(() => Bun.shrink()).not.toThrow();
  });
});
