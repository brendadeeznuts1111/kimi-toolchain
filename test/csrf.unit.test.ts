import { describe, expect, test } from "bun:test";
import {
  generateCsrfToken,
  verifyCsrfToken,
  verifyCsrfTokenDetailed,
  verifyCsrfTokenOrThrow,
  CsrfManager,
  constantTimeEqual,
  isCsrfError,
} from "../src/lib/csrf.ts";

const TEST_SECRET = "test-csrf-secret-key";
const TEST_SESSION = "session-123";

describe("csrf > generateCsrfToken", () => {
  test("generates a non-empty token string", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  test("generates unique tokens", () => {
    const t1 = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    const t2 = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    expect(t1).not.toBe(t2);
  });

  test("accepts custom algorithm", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, algorithm: "sha512" });
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  test("accepts hex encoding", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, encoding: "hex" });
    expect(token).toBeDefined();
    expect(/^[0-9a-f]+$/i.test(token)).toBe(true);
  });
});

describe("csrf > verifyCsrfToken", () => {
  test("verifies a valid token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    expect(verifyCsrfToken(token, TEST_SECRET, { sessionId: TEST_SESSION })).toBe(true);
  });

  test("rejects token with wrong secret", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    expect(verifyCsrfToken(token, "wrong-secret", { sessionId: TEST_SESSION })).toBe(false);
  });

  test("rejects token with wrong sessionId", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: "session-1" });
    expect(verifyCsrfToken(token, TEST_SECRET, { sessionId: "session-2" })).toBe(false);
  });

  test("accepts token with matching sessionId", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: "session-1" });
    expect(verifyCsrfToken(token, TEST_SECRET, { sessionId: "session-1" })).toBe(true);
  });

  test("rejects expired token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, expiresIn: 1 });
    const start = Date.now();
    while (Date.now() - start < 5) {}
    expect(verifyCsrfToken(token, TEST_SECRET, { sessionId: TEST_SESSION })).toBe(false);
  });

  test("rejects garbage input", () => {
    expect(verifyCsrfToken("not-a-real-token", TEST_SECRET, { sessionId: TEST_SESSION })).toBe(
      false
    );
  });
});

describe("csrf > verifyCsrfTokenDetailed", () => {
  test("returns valid result for correct token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    const result = verifyCsrfTokenDetailed(token, TEST_SECRET, { sessionId: TEST_SESSION });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("returns csrf_token_invalid for garbage token", () => {
    const result = verifyCsrfTokenDetailed("garbage", TEST_SECRET, { sessionId: TEST_SESSION });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("csrf_token_invalid");
  });

  test("returns csrf_token_invalid for empty token", () => {
    const result = verifyCsrfTokenDetailed("", TEST_SECRET, { sessionId: TEST_SESSION });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("csrf_token_invalid");
  });

  test("returns csrf_token_invalid for wrong sessionId", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: "session-1" });
    const result = verifyCsrfTokenDetailed(token, TEST_SECRET, { sessionId: "session-2" });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("csrf_token_invalid");
  });

  test("returns csrf_token_expired for expired token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, expiresIn: 60_000 });
    const result = verifyCsrfTokenDetailed(token, TEST_SECRET, {
      sessionId: TEST_SESSION,
      maxAge: 1,
    });
    const start = Date.now();
    while (Date.now() - start < 5) {}
    const result2 = verifyCsrfTokenDetailed(token, TEST_SECRET, {
      sessionId: TEST_SESSION,
      maxAge: 1,
    });
    expect(result2.valid).toBe(false);
    expect(result2.reason).toBe("csrf_token_expired");
  });
});

describe("csrf > verifyCsrfTokenOrThrow", () => {
  test("passes for valid token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION });
    expect(() =>
      verifyCsrfTokenOrThrow(token, TEST_SECRET, { sessionId: TEST_SESSION })
    ).not.toThrow();
  });

  test("throws for invalid token", () => {
    try {
      verifyCsrfTokenOrThrow("garbage", TEST_SECRET, { sessionId: TEST_SESSION });
      expect(false).toBe(true);
    } catch (err) {
      expect(isCsrfError(err, "csrf_token_invalid")).toBe(true);
    }
  });
  test("throws csrf_token_expired for expired token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, expiresIn: 60_000 });
    const start = Date.now();
    while (Date.now() - start < 5) {}
    try {
      verifyCsrfTokenOrThrow(token, TEST_SECRET, { sessionId: TEST_SESSION, maxAge: 1 });
      expect(false).toBe(true);
    } catch (err) {
      expect(isCsrfError(err, "csrf_token_expired")).toBe(true);
    }
  });
});

describe("csrf > CsrfManager", () => {
  test("generate + verify round-trip", () => {
    const mgr = new CsrfManager(TEST_SECRET);
    const token = mgr.generate(TEST_SESSION);
    expect(mgr.verify(token, TEST_SESSION)).toBe(true);
  });

  test("generate + verify with sessionId", () => {
    const mgr = new CsrfManager(TEST_SECRET);
    const token = mgr.generate("session-1");
    expect(mgr.verify(token, "session-1")).toBe(true);
    expect(mgr.verify(token, "session-2")).toBe(false);
  });

  test("verifyOrThrow throws on invalid", () => {
    const mgr = new CsrfManager(TEST_SECRET);
    try {
      mgr.verifyOrThrow("garbage", TEST_SESSION);
      expect(false).toBe(true);
    } catch (err) {
      expect(isCsrfError(err, "csrf_token_invalid")).toBe(true);
    }
  });

  test("respects custom TTL (expired token rejected)", () => {
    const mgr = new CsrfManager(TEST_SECRET, { ttlSeconds: 1 });
    const token = mgr.generate(TEST_SESSION);
    const start = Date.now();
    while (Date.now() - start < 1100) {}
    expect(mgr.verify(token, TEST_SESSION)).toBe(false);
  });

  test("verifyDetailed returns csrf_token_expired for expired token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, expiresIn: 60_000 });
    const start = Date.now();
    while (Date.now() - start < 5) {}
    const result = verifyCsrfTokenDetailed(token, TEST_SECRET, {
      sessionId: TEST_SESSION,
      maxAge: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("csrf_token_expired");
  });

  test("verifyOrThrow throws csrf_token_expired for expired token", () => {
    const token = generateCsrfToken(TEST_SECRET, { sessionId: TEST_SESSION, expiresIn: 60_000 });
    const start = Date.now();
    while (Date.now() - start < 5) {}
    try {
      verifyCsrfTokenOrThrow(token, TEST_SECRET, { sessionId: TEST_SESSION, maxAge: 1 });
      expect(false).toBe(true);
    } catch (err) {
      expect(isCsrfError(err, "csrf_token_expired")).toBe(true);
    }
  });

  test("supports custom algorithm", () => {
    const mgr = new CsrfManager(TEST_SECRET, { algorithm: "sha512" });
    const token = mgr.generate(TEST_SESSION);
    expect(mgr.verify(token, TEST_SESSION)).toBe(true);
  });
});

describe("csrf > constantTimeEqual", () => {
  test("returns true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });

  test("returns false for different strings", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });

  test("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  test("returns true for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
