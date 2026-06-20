/**
 * Bun.plugin and Bun.allocUnsafe correctness tests.
 */
import { describe, expect, test } from "bun:test";

describe("bun-plugin", () => {
  test("Bun.plugin is available", () => {
    expect(typeof Bun.plugin).toBe("function");
  });
});

describe("bun-alloc-unsafe", () => {
  test("Bun.allocUnsafe returns Uint8Array", () => {
    const buf = Bun.allocUnsafe(64);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBe(64);
  });

  test("Bun.allocUnsafe is available", () => {
    expect(typeof Bun.allocUnsafe).toBe("function");
  });
});
