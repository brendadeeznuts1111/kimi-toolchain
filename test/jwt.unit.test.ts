import { describe, expect, test } from "bun:test";
import { signJwt, verifyJwt, decodeJwt, isJwtError } from "../src/lib/jwt.ts";

const TEST_SECRET = "test-secret-key-for-unit-tests";

describe("jwt > signJwt", () => {
  test("creates a valid 3-part JWT", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  test("includes iat and exp claims", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET);
    const { claims } = decodeJwt(token);
    expect(claims.iat).toBeDefined();
    expect(claims.exp).toBeDefined();
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  test("respects custom TTL", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET, {
      ttlSeconds: 7200,
    });
    const { claims } = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(7200);
  });

  test("preserves custom claims", () => {
    const token = signJwt({ sub: "user-123", role: "admin", custom: "data" }, TEST_SECRET);
    const { claims } = decodeJwt(token);
    expect(claims.sub).toBe("user-123");
    expect(claims.role).toBe("admin");
    expect(claims.custom).toBe("data");
  });

  test("uses HS256 by default", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET);
    const { header } = decodeJwt(token);
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
  });

  test("supports HS384", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET, {
      algorithm: "HS384",
    });
    const { header } = decodeJwt(token);
    expect(header.alg).toBe("HS384");
  });

  test("supports HS512", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET, {
      algorithm: "HS512",
    });
    const { header } = decodeJwt(token);
    expect(header.alg).toBe("HS512");
  });
});

describe("jwt > verifyJwt", () => {
  test("verifies a valid token", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET);
    const verified = verifyJwt(token, TEST_SECRET);
    expect(verified.claims.sub).toBe("user-123");
    expect(verified.header.alg).toBe("HS256");
  });

  test("throws on wrong secret", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET);
    try {
      verifyJwt(token, "wrong-secret");
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_invalid_signature")).toBe(true);
    }
  });

  test("throws on expired token", () => {
    const token = signJwt(
      { sub: "user-123", exp: Math.floor(Date.now() / 1000) - 10 },
      TEST_SECRET
    );
    try {
      verifyJwt(token, TEST_SECRET);
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_expired")).toBe(true);
    }
  });

  test("throws on not-yet-valid token", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const token = signJwt({ sub: "user-123", nbf: future }, TEST_SECRET);
    try {
      verifyJwt(token, TEST_SECRET);
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_not_yet_valid")).toBe(true);
    }
  });

  test("throws on invalid format", () => {
    try {
      verifyJwt("not.a.jwt", TEST_SECRET);
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_invalid_format")).toBe(true);
    }
  });

  test("throws on 2-part token", () => {
    try {
      verifyJwt("only.two", TEST_SECRET);
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_invalid_format")).toBe(true);
    }
  });

  test("validates issuer", () => {
    const token = signJwt({ sub: "user-123", iss: "my-app" }, TEST_SECRET);
    const verified = verifyJwt(token, TEST_SECRET, {
      issuer: "my-app",
    });
    expect(verified.claims.iss).toBe("my-app");

    try {
      verifyJwt(token, TEST_SECRET, { issuer: "wrong-issuer" });
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_invalid_signature")).toBe(true);
    }
  });

  test("validates audience", () => {
    const token = signJwt({ sub: "user-123", aud: "my-api" }, TEST_SECRET);
    const verified = verifyJwt(token, TEST_SECRET, {
      audience: "my-api",
    });
    expect(verified.claims.aud).toBe("my-api");
  });

  test("verifies HS384 tokens", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET, {
      algorithm: "HS384",
    });
    const verified = verifyJwt(token, TEST_SECRET);
    expect(verified.header.alg).toBe("HS384");
    expect(verified.claims.sub).toBe("user-123");
  });

  test("verifies HS512 tokens", () => {
    const token = signJwt({ sub: "user-123" }, TEST_SECRET, {
      algorithm: "HS512",
    });
    const verified = verifyJwt(token, TEST_SECRET);
    expect(verified.header.alg).toBe("HS512");
    expect(verified.claims.sub).toBe("user-123");
  });
});

describe("jwt > decodeJwt", () => {
  test("decodes without verification", () => {
    const token = signJwt({ sub: "user-123", role: "admin" }, TEST_SECRET);
    const { header, claims } = decodeJwt(token);
    expect(header.alg).toBe("HS256");
    expect(claims.sub).toBe("user-123");
    expect(claims.role).toBe("admin");
  });

  test("throws on invalid format", () => {
    try {
      decodeJwt("invalid");
      expect(false).toBe(true);
    } catch (err) {
      expect(isJwtError(err, "jwt_invalid_format")).toBe(true);
    }
  });
});
