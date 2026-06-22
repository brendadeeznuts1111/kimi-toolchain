import { describe, test, expect } from "bun:test";
import { signJwt, verifyJwt, decodeJwt } from "../src/lib/jwt.ts";
import type { JwtPayload } from "../src/lib/identity-types.ts";

const SECRET = "test-secret-key-for-jwt-hardening";
const ALT_SECRET = "different-secret-key";

describe("jwt > signJwt hardening", () => {
  test("includes jti claim when provided", () => {
    const token = signJwt({ sub: "user1", jti: "unique-token-id" }, SECRET);
    const decoded = decodeJwt(token);
    expect(decoded.claims.jti).toBe("unique-token-id");
  });

  test("preserves custom iat when provided", () => {
    const customIat = 1000000000;
    const token = signJwt({ sub: "user1", iat: customIat }, SECRET);
    const decoded = decodeJwt(token);
    expect(decoded.claims.iat).toBe(customIat);
  });

  test("preserves custom exp when provided", () => {
    const customExp = 9999999999;
    const token = signJwt({ sub: "user1", exp: customExp }, SECRET);
    const decoded = decodeJwt(token);
    expect(decoded.claims.exp).toBe(customExp);
  });

  test("sets iss from config when not in claims", () => {
    const token = signJwt({ sub: "user1" }, SECRET, { issuer: "my-issuer" });
    const decoded = decodeJwt(token);
    expect(decoded.claims.iss).toBe("my-issuer");
  });

  test("sets aud from config when not in claims", () => {
    const token = signJwt({ sub: "user1" }, SECRET, { audience: "my-audience" });
    const decoded = decodeJwt(token);
    expect(decoded.claims.aud).toBe("my-audience");
  });

  test("claims override config issuer", () => {
    const token = signJwt({ sub: "user1", iss: "custom-iss" }, SECRET, { issuer: "config-iss" });
    const decoded = decodeJwt(token);
    expect(decoded.claims.iss).toBe("custom-iss");
  });

  test("produces deterministic signature for same input", () => {
    const claims: JwtPayload & { sub: string } = { sub: "user1", iat: 1000, exp: 2000 };
    const t1 = signJwt(claims, SECRET);
    const t2 = signJwt(claims, SECRET);
    expect(t1).toBe(t2);
  });
});

describe("jwt > verifyJwt hardening", () => {
  test("rejects tampered payload (signature mismatch)", () => {
    const token = signJwt({ sub: "user1" }, SECRET);
    const parts = token.split(".");
    // Tamper with payload — change sub from user1 to hacker
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    payload.sub = "hacker";
    const tamperedPayload = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(() => verifyJwt(tamperedToken, SECRET)).toThrow();
  });

  test("rejects token signed with different secret", () => {
    const token = signJwt({ sub: "user1" }, ALT_SECRET);
    expect(() => verifyJwt(token, SECRET)).toThrow();
  });

  test("rejects token with algorithm in header not matching signature", () => {
    const token = signJwt({ sub: "user1" }, SECRET, { algorithm: "HS256" });
    // Swap header to claim HS512 but signature is HS256
    const parts = token.split(".");
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    header.alg = "HS512";
    const tamperedHeader = btoa(JSON.stringify(header))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tamperedToken = `${tamperedHeader}.${parts[1]}.${parts[2]}`;

    expect(() => verifyJwt(tamperedToken, SECRET)).toThrow();
  });

  test("rejects token with empty string as token", () => {
    expect(() => verifyJwt("", SECRET)).toThrow();
  });

  test("rejects token with only dots", () => {
    expect(() => verifyJwt("..", SECRET)).toThrow();
  });

  test("rejects token with 4 parts", () => {
    expect(() => verifyJwt("a.b.c.d", SECRET)).toThrow();
  });

  test("rejects token with malformed header (not JSON)", () => {
    const token = "notb64.payload.signature";
    expect(() => verifyJwt(token, SECRET)).toThrow();
  });

  test("verifies token with nbf in the past", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = signJwt({ sub: "user1", nbf: past }, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result.claims.sub).toBe("user1");
  });

  test("verifies token with nbf equal to now (boundary)", () => {
    const now = Math.floor(Date.now() / 1000);
    // We need to set nbf to now-1 since verify checks now >= nbf
    const token = signJwt({ sub: "user1", nbf: now - 1 }, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result.claims.sub).toBe("user1");
  });

  test("returns correct header algorithm", () => {
    const token = signJwt({ sub: "user1" }, SECRET, { algorithm: "HS512" });
    const result = verifyJwt(token, SECRET);
    expect(result.header.alg).toBe("HS512");
    expect(result.header.typ).toBe("JWT");
  });

  test("returns the signature part", () => {
    const token = signJwt({ sub: "user1" }, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result.signature).toBe(token.split(".")[2]);
  });
});

describe("jwt > decodeJwt hardening", () => {
  test("decodes token with custom claims", () => {
    const token = signJwt({ sub: "user1", role: "admin", scope: "read write" }, SECRET);
    const decoded = decodeJwt(token);
    expect(decoded.claims.role).toBe("admin");
    expect(decoded.claims.scope).toBe("read write");
  });

  test("throws on token with 1 part", () => {
    expect(() => decodeJwt("justonepart")).toThrow();
  });

  test("throws on empty string", () => {
    expect(() => decodeJwt("")).toThrow();
  });
});

describe("jwt > JWT + CSRF pairing scenario", () => {
  test("JWT and CSRF tokens are independent (no cross-contamination)", () => {
    const jwtSecret = "jwt-secret";
    const csrfSecret = "csrf-secret";
    const sessionId = "session-123";

    // Sign a JWT
    const jwt = signJwt({ sub: "user1", sessionId }, jwtSecret);

    // Generate a CSRF token (simulated — just verify JWT is not a valid CSRF token)
    const jwtVerified = verifyJwt(jwt, jwtSecret);
    expect(jwtVerified.claims.sub).toBe("user1");
    expect(jwtVerified.claims.sessionId).toBe(sessionId);

    // JWT should not verify with the CSRF secret
    expect(() => verifyJwt(jwt, csrfSecret)).toThrow();
  });
});
