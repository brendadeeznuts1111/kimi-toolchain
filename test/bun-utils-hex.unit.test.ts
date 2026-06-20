import { describe, expect, test } from "bun:test";
import { decodeHex, encodeHex, utf8ByteLength } from "../src/lib/bun-utils.ts";

describe("hex encoding wrapper", () => {
  test("encodeHex / decodeHex round-trip for hello world bytes", () => {
    const bytes = new TextEncoder().encode("hello world");
    const encoded = encodeHex(bytes);
    expect(encoded).toBe("68656c6c6f20776f726c64");
    expect(decodeHex(encoded)).toEqual(bytes);
  });

  test("encodeHex matches Uint8Array.toHex()", () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    expect(encodeHex(bytes)).toBe(bytes.toHex());
  });

  test("decodeHex matches Uint8Array.fromHex()", () => {
    expect(decodeHex("deadbeef")).toEqual(Uint8Array.fromHex("deadbeef"));
  });

  test("utf8ByteLength matches TextEncoder for UTF-8 text", () => {
    const text = "hello 世界";
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).byteLength);
  });
});