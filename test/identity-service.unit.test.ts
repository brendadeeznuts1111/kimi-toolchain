import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { Identity, IdentityTest } from "../src/lib/effect/identity-service.ts";
import {
  JwtExpired,
  JwtInvalidSignature,
  JwtInvalidFormat,
  SessionNotFound,
} from "../src/lib/effect/errors.ts";

const TEST_JWT_SECRET = "test-jwt-secret";
const TEST_CSRF_SECRET = "test-csrf-secret";

const testLayer = IdentityTest({
  jwtSecret: TEST_JWT_SECRET,
  csrfSecret: TEST_CSRF_SECRET,
});

function run<A, E>(effect: Effect.Effect<A, E, Identity>): Promise<A> {
  return Effect.runPromise(Effect.provide(testLayer)(effect));
}

function runEither<A, E>(effect: Effect.Effect<A, E, Identity>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.provide(testLayer)(Effect.either(effect)));
}

describe("identity-service > JWT", () => {
  test("signToken produces a 3-part JWT", async () => {
    const token = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.signToken({ sub: "user-123" });
      })
    );
    expect(token.split(".")).toHaveLength(3);
  });

  test("verifyToken round-trip", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "user-123", role: "admin" });
        return yield* id.verifyToken(token);
      })
    );
    expect(result.claims.sub).toBe("user-123");
    expect(result.claims.role).toBe("admin");
    expect(result.header.alg).toBe("HS256");
  });

  test("verifyToken fails on wrong secret via config", async () => {
    const either = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "user-123" }, { secret: "other-secret" });
        return yield* id.verifyToken(token);
      })
    );
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left instanceof JwtInvalidSignature).toBe(true);
    }
  });

  test("verifyToken fails on expired token", async () => {
    const either = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({
          sub: "user-123",
          exp: Math.floor(Date.now() / 1000) - 10,
        });
        return yield* id.verifyToken(token);
      })
    );
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left instanceof JwtExpired).toBe(true);
    }
  });

  test("verifyToken fails on invalid format", async () => {
    const either = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.verifyToken("not.a.jwt");
      })
    );
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left instanceof JwtInvalidFormat).toBe(true);
    }
  });

  test("decodeToken without verification", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "user-123", custom: "x" });
        return yield* id.decodeToken(token);
      })
    );
    expect(result.claims.sub).toBe("user-123");
    expect(result.claims.custom).toBe("x");
  });

  test("signToken with custom TTL", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "u1" }, { ttlSeconds: 7200 });
        return yield* id.decodeToken(token);
      })
    );
    expect(result.claims.exp! - result.claims.iat!).toBe(7200);
  });

  test("signToken with HS384", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "u1" }, { algorithm: "HS384" });
        return yield* id.verifyToken(token);
      })
    );
    expect(result.header.alg).toBe("HS384");
  });
});

describe("identity-service > Session", () => {
  test("createSession returns a session record", async () => {
    const session = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.createSession("user-123");
      })
    );
    expect(session.userId).toBe("user-123");
    expect(session.active).toBe(true);
    expect(session.id).toBeDefined();
  });

  test("getSession retrieves created session", async () => {
    const session = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const created = yield* id.createSession("user-123");
        return yield* id.getSession(created.id);
      })
    );
    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user-123");
  });

  test("getSession returns null for non-existent", async () => {
    const session = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.getSession("nonexistent");
      })
    );
    expect(session).toBeNull();
  });

  test("verifySession succeeds for valid session", async () => {
    const session = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const created = yield* id.createSession("user-123");
        return yield* id.verifySession(created.id, "user-123");
      })
    );
    expect(session.userId).toBe("user-123");
  });

  test("verifySession fails for non-existent", async () => {
    const either = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.verifySession("nonexistent");
      })
    );
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left instanceof SessionNotFound).toBe(true);
    }
  });

  test("revokeSession removes session", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const created = yield* id.createSession("user-123");
        const revoked = yield* id.revokeSession(created.id);
        const after = yield* id.getSession(created.id);
        return { revoked, after };
      })
    );
    expect(result.revoked).toBe(true);
    expect(result.after).toBeNull();
  });

  test("revokeAllSessionsForUser removes all", async () => {
    const count = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        yield* id.createSession("user-1");
        yield* id.createSession("user-1");
        yield* id.createSession("user-2");
        return yield* id.revokeAllSessionsForUser("user-1");
      })
    );
    expect(count).toBe(2);
  });

  test("createSession stores metadata", async () => {
    const session = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.createSession("user-1", { ip: "127.0.0.1" });
      })
    );
    expect(session.metadata).toEqual({ ip: "127.0.0.1" });
  });
});

describe("identity-service > Session Cookies", () => {
  test("sessionCookie produces Set-Cookie header", async () => {
    const cookie = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return id.sessionCookie("session-123");
      })
    );
    expect(cookie).toContain("session=session-123");
    expect(cookie).toContain("HttpOnly");
  });

  test("parseSessionCookie extracts session ID", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return id.parseSessionCookie("session=abc-123; theme=dark");
      })
    );
    expect(result).toBe("abc-123");
  });

  test("parseSessionCookie returns null for empty", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return id.parseSessionCookie(null);
      })
    );
    expect(result).toBeNull();
  });

  test("clearSessionCookie produces maxAge=0", async () => {
    const cookie = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return id.clearSessionCookie();
      })
    );
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("identity-service > CSRF", () => {
  test("generateCsrf + verifyCsrf round-trip", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-1");
        return yield* id.verifyCsrf(token, "session-1");
      })
    );
    expect(result).toBe(true);
  });

  test("verifyCsrf fails with wrong sessionId", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-1");
        return yield* id.verifyCsrf(token, "session-2");
      })
    );
    expect(result).toBe(false);
  });

  test("verifyCsrf fails with garbage token", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.verifyCsrf("garbage", "session-1");
      })
    );
    expect(result).toBe(false);
  });
});

describe("identity-service > Password", () => {
  test("hashPassword + verifyPassword round-trip", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const hash = yield* id.hashPassword("my-secret-password");
        return yield* id.verifyPassword("my-secret-password", hash);
      })
    );
    expect(result).toBe(true);
  });

  test("verifyPassword fails with wrong password", async () => {
    const result = await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const hash = yield* id.hashPassword("correct-password");
        return yield* id.verifyPassword("wrong-password", hash);
      })
    );
    expect(result).toBe(false);
  });
});
