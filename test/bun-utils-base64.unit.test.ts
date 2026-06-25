import { describe, expect, test } from "bun:test";
import {
  decodeBase64Bytes,
  decodeBase64UrlBytes,
  encodeBase64Bytes,
  encodeBase64UrlBytes,
} from "../src/lib/bun-utils.ts";
import { signJwt, verifyJwt } from "../src/lib/jwt.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

describe("base64 encoding wrapper", () => {
  test("guide example: btoa/atob round-trip for hello world", () => {
    const data = "hello world";
    const encoded = btoa(data);
    expect(encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(atob(encoded)).toBe("hello world");
  });

  test("btoa/atob round-trip string data", () => {
    const data = "kimi-toolchain";
    expect(atob(btoa(data))).toBe(data);
  });

  test("bytes helpers round-trip UTF-8 text", () => {
    const text = "hello world";
    const bytes = textEncoder.encode(text);
    const encoded = encodeBase64Bytes(bytes);
    expect(encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(textDecoder.decode(decodeBase64Bytes(encoded))).toBe(text);
  });

  test("bytes helpers round-trip arbitrary binary", () => {
    const bytes = Uint8Array.from([0, 1, 255, 128, 42]);
    const encoded = encodeBase64Bytes(bytes);
    expect(decodeBase64Bytes(encoded)).toEqual(bytes);
  });

  test("base64url helpers round-trip JWT-shaped JSON bytes", () => {
    const payload = textEncoder.encode(JSON.stringify({ sub: "user", exp: 9_999_999_999 }));
    const encoded = encodeBase64UrlBytes(payload);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(textDecoder.decode(decodeBase64UrlBytes(encoded))).toBe(
      JSON.stringify({ sub: "user", exp: 9_999_999_999 })
    );
  });

  test("jwt sign/verify uses base64url byte helpers", () => {
    const token = signJwt({ sub: "base64url-ssot" }, "test-secret", { ttlSeconds: 3600 });
    const verified = verifyJwt(token, "test-secret");
    expect(verified.claims.sub).toBe("base64url-ssot");
  });

  test("atob throws on invalid input", () => {
    expect(() => atob("not!!!valid")).toThrow();
  });
});
