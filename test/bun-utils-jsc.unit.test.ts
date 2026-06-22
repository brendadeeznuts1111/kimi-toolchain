import { describe, expect, test } from "bun:test";
import {
  estimateShallowMemoryUsage,
  structuredCloneDeserialize,
  structuredCloneSerialize,
} from "../src/lib/bun-utils.ts";

describe("bun-utils-jsc", () => {
  test("structuredCloneSerialize round-trips primitive values", () => {
    const original = { foo: "bar", nested: { count: 42 }, tags: ["a", "b"] };
    const buffer = structuredCloneSerialize(original);
    expect(buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const restored = structuredCloneDeserialize<typeof original>(buffer);
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
  });

  test("estimateShallowMemoryUsage returns a non-negative number", () => {
    const obj = { foo: "bar" };
    const usage = estimateShallowMemoryUsage(obj);
    expect(typeof usage).toBe("number");
    expect(Number.isFinite(usage)).toBe(true);
    expect(usage).toBeGreaterThanOrEqual(0);
  });

  test("estimateShallowMemoryUsage reports larger size for larger buffers", () => {
    const small = Buffer.alloc(16);
    const large = Buffer.alloc(1024 * 1024);
    expect(estimateShallowMemoryUsage(large)).toBeGreaterThan(estimateShallowMemoryUsage(small));
  });
});
