import { describe, expect, test } from "bun:test";
import { deserialize, estimateShallowMemoryUsageOf, serialize } from "bun:jsc";

describe("bun-utils-jsc", () => {
  test("serialize round-trips primitive values", () => {
    const original = { foo: "bar", nested: { count: 42 }, tags: ["a", "b"] };
    const buffer = serialize(original) as ArrayBufferLike;
    expect(buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const restored = deserialize(buffer) as typeof original;
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
  });

  test("estimateShallowMemoryUsageOf returns a non-negative number", () => {
    const obj = { foo: "bar" };
    const usage = estimateShallowMemoryUsageOf(obj);
    expect(typeof usage).toBe("number");
    expect(Number.isFinite(usage)).toBe(true);
    expect(usage).toBeGreaterThanOrEqual(0);
  });

  test("estimateShallowMemoryUsageOf reports larger size for larger buffers", () => {
    const small = Buffer.alloc(16);
    const large = Buffer.alloc(1024 * 1024);
    expect(estimateShallowMemoryUsageOf(large)).toBeGreaterThan(
      estimateShallowMemoryUsageOf(small)
    );
  });
});
