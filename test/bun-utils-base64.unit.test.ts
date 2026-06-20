import { describe, expect, test } from "bun:test";
import {
  decodeBase64,
  decodeBase64Bytes,
  encodeBase64,
  encodeBase64Bytes,
} from "../src/lib/bun-utils.ts";

describe("base64 encoding wrapper", () => {
  test("guide example: btoa/atob round-trip for hello world", () => {
    const data = "hello world";
    const encoded = encodeBase64(data);
    expect(encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(decodeBase64(encoded)).toBe("hello world");
  });

  test("encodeBase64 matches bare btoa", () => {
    const data = "kimi-toolchain";
    expect(encodeBase64(data)).toBe(btoa(data));
    expect(decodeBase64(btoa(data))).toBe(data);
  });

  test("bytes helpers round-trip UTF-8 text", () => {
    const text = "hello world";
    const bytes = new TextEncoder().encode(text);
    const encoded = encodeBase64Bytes(bytes);
    expect(encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(new TextDecoder().decode(decodeBase64Bytes(encoded))).toBe(text);
  });

  test("bytes helpers round-trip arbitrary binary", () => {
    const bytes = Uint8Array.from([0, 1, 255, 128, 42]);
    const encoded = encodeBase64Bytes(bytes);
    expect(decodeBase64Bytes(encoded)).toEqual(bytes);
  });

  test("decodeBase64 throws on invalid input", () => {
    expect(() => decodeBase64("not!!!valid")).toThrow();
  });
});