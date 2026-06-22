import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { signJwt, verifyJwt, decodeJwt, isJwtError } from "../src/lib/jwt.ts";

const SECRET = "property-test-secret-key-that-is-long-enough-for-hmac";
const ALT_SECRET = "different-property-test-secret-key-that-is-long-enough";

const nowSeconds = () => Math.floor(Date.now() / 1000);

const safeClaims = () =>
  fc.record({
    sub: fc.string({ minLength: 1, maxLength: 100 }),
    iat: fc.integer({ min: 0, max: 4102444800 }),
    exp: fc.integer({ min: 1000, max: 4102444800 }),
    jti: fc.option(fc.uuid(), { nil: undefined }),
    iss: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    aud: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  });

describe("JWT properties", () => {
  test("sign → verify roundtrip preserves core claims", () => {
    fc.assert(
      fc.property(safeClaims(), (partialClaims) => {
        const claims = {
          ...partialClaims,
          exp: Math.max(partialClaims.iat + 60, partialClaims.exp, nowSeconds() + 60),
        };

        const token = signJwt(claims, SECRET);
        const result = verifyJwt(token, SECRET);

        expect(result.claims.sub).toBe(claims.sub);
        expect(result.claims.iat).toBe(claims.iat);
        expect(result.claims.exp).toBe(claims.exp);
        expect(result.claims.jti).toBe(claims.jti);
        expect(result.claims.iss).toBe(claims.iss);
        expect(result.claims.aud).toBe(claims.aud);
        expect(result.header.alg).toBe("HS256");
        expect(result.header.typ).toBe("JWT");
      }),
      { numRuns: 200 }
    );
  });

  test("decodeJwt returns the same claims as verifyJwt without signature check", () => {
    fc.assert(
      fc.property(safeClaims(), (partialClaims) => {
        const claims = {
          ...partialClaims,
          exp: Math.max(partialClaims.iat + 60, partialClaims.exp, nowSeconds() + 60),
        };

        const token = signJwt(claims, SECRET);
        const decoded = decodeJwt(token);
        const verified = verifyJwt(token, SECRET);

        expect(decoded.claims).toEqual(verified.claims);
        expect(decoded.header).toEqual(verified.header);
      }),
      { numRuns: 100 }
    );
  });

  test("tampering with the payload always fails verification", () => {
    fc.assert(
      fc.property(
        fc.record({
          sub: fc.string({ minLength: 1, maxLength: 100 }),
          tamperedSub: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        ({ sub, tamperedSub }) => {
          fc.pre(sub !== tamperedSub);

          const token = signJwt(
            { sub, exp: nowSeconds() + 3600 },
            SECRET
          );
          const parts = token.split(".");
          const payload = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
          );
          payload.sub = tamperedSub;
          const tamperedPayload = btoa(JSON.stringify(payload))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

          expect(() => verifyJwt(tamperedToken, SECRET)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test("token signed with one secret never verifies with another", () => {
    fc.assert(
      fc.property(
        fc.record({
          sub: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        ({ sub }) => {
          const token = signJwt({ sub, exp: nowSeconds() + 3600 }, SECRET);

          try {
            verifyJwt(token, ALT_SECRET);
            expect(false).toBe(true);
          } catch (err) {
            expect(isJwtError(err, "jwt_invalid_signature")).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test("expired token always fails verification", () => {
    fc.assert(
      fc.property(
        fc.record({
          sub: fc.string({ minLength: 1, maxLength: 100 }),
          iat: fc.integer({ min: 0, max: nowSeconds() - 2 }),
        }),
        ({ sub, iat }) => {
          const token = signJwt({ sub, iat, exp: iat + 1 }, SECRET);

          try {
            verifyJwt(token, SECRET);
            expect(false).toBe(true);
          } catch (err) {
            expect(isJwtError(err, "jwt_expired")).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test("algorithm mismatch in header always fails verification", () => {
    fc.assert(
      fc.property(
        fc.record({
          sub: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        ({ sub }) => {
          const token = signJwt({ sub, exp: nowSeconds() + 3600 }, SECRET);
          const parts = token.split(".");
          const header = JSON.parse(
            atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))
          );
          header.alg = header.alg === "HS256" ? "HS512" : "HS256";
          const tamperedHeader = btoa(JSON.stringify(header))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const tamperedToken = `${tamperedHeader}.${parts[1]}.${parts[2]}`;

          expect(() => verifyJwt(tamperedToken, SECRET)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test("same input always produces the same signature", () => {
    fc.assert(
      fc.property(
        fc.record({
          sub: fc.string({ minLength: 1, maxLength: 100 }),
          iat: fc.integer({ min: 0, max: 4102444800 }),
          exp: fc.integer({ min: 1000, max: 4102444800 }),
        }),
        ({ sub, iat, exp }) => {
          const claims = { sub, iat, exp: Math.max(iat + 60, exp) };
          const t1 = signJwt(claims, SECRET);
          const t2 = signJwt(claims, SECRET);
          expect(t1).toBe(t2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
