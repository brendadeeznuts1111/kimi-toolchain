import { describe, expect, test } from "bun:test";
import { gzipBytes, gunzipBytes, gunzipText } from "../src/lib/bun-utils.ts";

describe("gzip compression wrapper", () => {
  test("guide example: gzipSync/gunzipSync round-trip for Hello, world!", () => {
    const data = new TextEncoder().encode("Hello, world!");
    const compressed = gzipBytes(data);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);
    expect(gunzipBytes(compressed)).toEqual(data);
  });

  test("string round-trip via gzipBytes and gunzipText", () => {
    const text = "Hello, world!";
    const compressed = gzipBytes(text);
    expect(gunzipText(compressed)).toBe(text);
  });

  test("bytes round-trip via gzipBytes and gunzipBytes", () => {
    const bytes = Uint8Array.from([0, 1, 255, 128, 42, 99]);
    const compressed = gzipBytes(bytes);
    expect(gunzipBytes(compressed)).toEqual(bytes);
  });

  test("gzipBytes matches bare Bun.gzipSync for UTF-8 input", () => {
    const data = new TextEncoder().encode("kimi-toolchain");
    expect(gzipBytes(data)).toEqual(Bun.gzipSync(data));
    const compressed = gzipBytes("kimi-toolchain");
    expect(gunzipBytes(compressed)).toEqual(data);
  });
});
