import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Either, Layer } from "effect";
import { Identity, IdentityTest, IdentityLive } from "../src/lib/effect/identity-service.ts";
import { MOCK_CLOCK_EPOCH, utcSeconds, withSystemTime } from "./helpers/mock-clock.ts";
import {
  JwtExpired,
  JwtInvalidSignature,
  JwtInvalidFormat,
  JwtMissingSecret,
  CsrfTokenInvalid,
  CsrfTokenExpired,
  SessionNotFound,
  SecretPolicyViolation,
} from "../src/lib/effect/errors.ts";
import { SecretsTest } from "../src/lib/effect/secrets-service.ts";
import type { SecretsBackend } from "../src/lib/secrets-types.ts";
import { clearSessionCookie, parseSessionCookie, sessionCookieHeader } from "../src/lib/session.ts";
import { removePath, testTempPath, writeText } from "./helpers.ts";

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
  afterEach(() => {
    setSystemTime();
  });
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
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      const either = await runEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          const token = yield* id.signToken({
            sub: "user-123",
            exp: utcSeconds() - 10,
          });
          return yield* id.verifyToken(token);
        })
      );
      expect(Either.isLeft(either)).toBe(true);
      if (Either.isLeft(either)) {
        expect(either.left instanceof JwtExpired).toBe(true);
      }
    });
  });

  test("verifyToken TTL boundary without busy-wait", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      const token = await run(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.signToken({ sub: "user-123" }, { ttlSeconds: 1 });
        })
      );

      const validNow = await runEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.verifyToken(token);
        })
      );
      expect(Either.isRight(validNow)).toBe(true);

      setSystemTime(new Date(MOCK_CLOCK_EPOCH.getTime() + 999));
      const validBeforeExpiry = await runEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.verifyToken(token);
        })
      );
      expect(Either.isRight(validBeforeExpiry)).toBe(true);

      setSystemTime(new Date(MOCK_CLOCK_EPOCH.getTime() + 1001));
      const expired = await runEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.verifyToken(token);
        })
      );
      expect(Either.isLeft(expired)).toBe(true);
      if (Either.isLeft(expired)) {
        expect(expired.left instanceof JwtExpired).toBe(true);
      }
    });
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

describe("identity-service > CSRF", () => {
  afterEach(() => {
    setSystemTime();
  });
  test("generateCsrf + verifyCsrf round-trip", async () => {
    await run(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-1");
        yield* id.verifyCsrf(token, "session-1");
      })
    );
  });

  test("verifyCsrf fails with wrong sessionId", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-1");
        yield* id.verifyCsrf(token, "session-2");
      })
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<CsrfTokenInvalid, unknown>).left).toBeInstanceOf(
      CsrfTokenInvalid
    );
  });

  test("verifyCsrf fails with garbage token", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        yield* id.verifyCsrf("garbage", "session-1");
      })
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<CsrfTokenInvalid, unknown>).left).toBeInstanceOf(
      CsrfTokenInvalid
    );
  });

  test("verifyCsrf fails with CsrfTokenExpired for expired token", async () => {
    const longTtlLayer = IdentityTest({
      jwtSecret: TEST_JWT_SECRET,
      csrfSecret: TEST_CSRF_SECRET,
      csrfConfig: { ttlSeconds: 60 },
    });
    const shortTtlLayer = IdentityTest({
      jwtSecret: TEST_JWT_SECRET,
      csrfSecret: TEST_CSRF_SECRET,
      csrfConfig: { ttlSeconds: 1 },
    });

    const token = await Effect.runPromise(
      Effect.provide(longTtlLayer)(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.generateCsrf("session-1");
        })
      )
    );

    // Bun.CSRF.verify ages against real wall clock — setSystemTime does not apply yet.
    // Generate with long TTL, verify with 1s maxAge: after 1.1s → csrf_token_expired (not invalid).
    await Bun.sleep(1100);

    const result = await Effect.runPromise(
      Effect.provide(shortTtlLayer)(
        Effect.either(
          Effect.gen(function* () {
            const id = yield* Identity;
            yield* id.verifyCsrf(token, "session-1");
          })
        )
      )
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<CsrfTokenExpired, unknown>).left).toBeInstanceOf(
      CsrfTokenExpired
    );
  });
});

// ── IdentityLive integration tests ───────────────────────────────────

const POLICY_PATH = new URL("../secrets-policy.json5", import.meta.url).pathname;

function makeBackend(store: Map<string, string>): SecretsBackend {
  return {
    get: async ({ service, name }) => store.get(`${service}:${name}`) ?? null,
    set: async ({ service, name, value }) => {
      store.set(`${service}:${name}`, value);
    },
    delete: async ({ service, name }) => store.delete(`${service}:${name}`),
  };
}

function runLive<A, E>(
  effect: Effect.Effect<A, E, Identity>,
  backend: SecretsBackend,
  policyPath: string = POLICY_PATH
): Promise<A> {
  // envVars: {} — hermetic: real-machine env (JWT_SECRET & friends) must not leak in.
  const secretsLayer = SecretsTest(backend, { policyPath, envVars: {} });
  const identityLayer = Layer.provide(IdentityLive, secretsLayer);
  return Effect.runPromise(Effect.provide(identityLayer)(effect));
}

function runLiveEither<A, E>(
  effect: Effect.Effect<A, E, Identity>,
  backend: SecretsBackend,
  policyPath: string = POLICY_PATH
): Promise<Either.Either<A, E>> {
  const secretsLayer = SecretsTest(backend, { policyPath, envVars: {} });
  const identityLayer = Layer.provide(IdentityLive, secretsLayer);
  return Effect.runPromise(Effect.provide(identityLayer)(Effect.either(effect)));
}

function writeRestrictedPolicy(path: string): void {
  writeText(
    path,
    JSON.stringify({
      $schema: "v1",
      "com.herdr.dashboard": {
        "jwt-secret": {
          allowedConsumers: ["herdr-server"],
          rotationDays: 30,
          lastRotated: null,
          version: 1,
        },
        "csrf-secret": {
          allowedConsumers: ["herdr-server"],
          rotationDays: 30,
          lastRotated: null,
          version: 1,
        },
      },
    })
  );
}

describe("identity-service > IdentityLive integration", () => {
  test("signToken resolves jwt-secret from SecretsManager", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
      ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
    ]);
    const token = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.signToken({ sub: "user-1" });
      }),
      makeBackend(store)
    );
    expect(token.split(".")).toHaveLength(3);
  });

  test("signToken fails with JwtMissingSecret when jwt-secret is absent", async () => {
    const store = new Map([["com.herdr.dashboard:csrf-secret", "live-csrf-secret"]]);
    const result = await runLiveEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.signToken({ sub: "user-1" });
      }),
      makeBackend(store)
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<JwtMissingSecret, unknown>).left).toBeInstanceOf(
      JwtMissingSecret
    );
  });

  test("verifyToken round-trip through SecretsManager", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
      ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
    ]);
    const claims = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "user-42" });
        const verified = yield* id.verifyToken(token);
        return verified.claims;
      }),
      makeBackend(store)
    );
    expect(claims.sub).toBe("user-42");
  });

  test("generateCsrf resolves csrf-secret from SecretsManager", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
      ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
    ]);
    const token = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.generateCsrf("session-live-1");
      }),
      makeBackend(store)
    );
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  test("generateCsrf fails with JwtMissingSecret when csrf-secret is absent", async () => {
    const store = new Map([["com.herdr.dashboard:jwt-secret", "live-jwt-secret"]]);
    const result = await runLiveEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.generateCsrf("session-live-1");
      }),
      makeBackend(store)
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<JwtMissingSecret, unknown>).left).toBeInstanceOf(
      JwtMissingSecret
    );
  });

  test("verifyCsrf round-trip through SecretsManager", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
      ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
    ]);
    await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-live-2");
        yield* id.verifyCsrf(token, "session-live-2");
      }),
      makeBackend(store)
    );
  });

  test("verifyCsrf fails with CsrfTokenInvalid for wrong sessionId through SecretsManager", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
      ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
    ]);
    const result = await runLiveEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.generateCsrf("session-live-3");
        yield* id.verifyCsrf(token, "session-live-WRONG");
      }),
      makeBackend(store)
    );
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<CsrfTokenInvalid, unknown>).left).toBeInstanceOf(
      CsrfTokenInvalid
    );
  });
});

// ── IdentityLive full auth flow tests ─────────────────────────────────

describe("identity-service > IdentityLive full auth flow", () => {
  const liveStore = new Map([
    ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
    ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
  ]);

  test("sign JWT → verify JWT → create session → generate CSRF → verify CSRF", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        const token = yield* id.signToken({ sub: "user-42", role: "admin" });
        const verified = yield* id.verifyToken(token);
        const session = yield* id.createSession("user-42", { ip: "127.0.0.1" });
        const csrf = yield* id.generateCsrf(session.id);
        yield* id.verifyCsrf(csrf, session.id);
        return { token, verified, session, csrf };
      }),
      makeBackend(liveStore)
    );
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.verified.claims.sub).toBe("user-42");
    expect(result.verified.claims.role).toBe("admin");
    expect(result.session.userId).toBe("user-42");
    expect(result.session.metadata).toEqual({ ip: "127.0.0.1" });
    expect(result.csrf.length).toBeGreaterThan(0);
  });

  test("session cookie round-trip via IdentityLive", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        const session = yield* id.createSession("user-42");
        const setCookie = sessionCookieHeader(session.id);
        const parsed = parseSessionCookie(setCookie);
        return { setCookie, parsed };
      }),
      makeBackend(liveStore)
    );
    expect(result.setCookie).toContain("session=");
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.parsed).toBe(result.setCookie.match(/session=([^;]+)/)?.[1] ?? null);
  });

  test("clear session cookie invalidates client cookie", async () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toMatch(/session=;|session="";/);
  });

  test("CSRF verification survives session revocation", async () => {
    const result = await runLiveEither(
      Effect.gen(function* () {
        const id = yield* Identity;
        const session = yield* id.createSession("user-42");
        const csrf = yield* id.generateCsrf(session.id);
        yield* id.revokeSession(session.id);
        // CSRF is stateless and bound only to sessionId; the session store is not consulted
        // during verification. The token should still verify even after its session is revoked.
        yield* id.verifyCsrf(csrf, session.id);
      }),
      makeBackend(liveStore)
    );
    // This assertion documents that CSRF verification is independent of the session store.
    // A future coupling change that consults the session store during CSRF verify will be caught here.
    expect(Either.isRight(result)).toBe(true);
  });

  test("max concurrent sessions evicts oldest sessions", async () => {
    // Default maxSessionsPerUser is 5; creating 6 sessions should evict the first.
    const result = await runLive(
      Effect.gen(function* () {
        const id = yield* Identity;
        const sessions: string[] = [];
        for (let i = 0; i < 6; i++) {
          const session = yield* id.createSession("user-42");
          sessions.push(session.id);
        }
        const oldest = sessions[0];
        if (!oldest) throw new Error("expected at least one session");
        const retrieved = yield* id.getSession(oldest);
        return { oldest, retrieved };
      }),
      makeBackend(liveStore)
    );
    expect(result.retrieved).toBeNull();
  });
});

// ── IdentityLive policy violation tests ─────────────────────────────

describe("identity-service > IdentityLive policy violations", () => {
  test("signToken fails with SecretPolicyViolation when identity-service is denied for jwt-secret", async () => {
    const policyPath = testTempPath("identity-secrets-policy");
    writeRestrictedPolicy(policyPath);
    try {
      const store = new Map([
        ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
        ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
      ]);
      const result = await runLiveEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.signToken({ sub: "user-1" });
        }),
        makeBackend(store),
        policyPath
      );
      expect(Either.isLeft(result)).toBe(true);
      expect((result as Either.Left<SecretPolicyViolation, unknown>).left).toBeInstanceOf(
        SecretPolicyViolation
      );
    } finally {
      removePath(policyPath, { force: true });
    }
  });

  test("generateCsrf fails with SecretPolicyViolation when identity-service is denied for csrf-secret", async () => {
    const policyPath = testTempPath("identity-secrets-policy");
    writeRestrictedPolicy(policyPath);
    try {
      const store = new Map([
        ["com.herdr.dashboard:jwt-secret", "live-jwt-secret"],
        ["com.herdr.dashboard:csrf-secret", "live-csrf-secret"],
      ]);
      const result = await runLiveEither(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.generateCsrf("session-1");
        }),
        makeBackend(store),
        policyPath
      );
      expect(Either.isLeft(result)).toBe(true);
      expect((result as Either.Left<SecretPolicyViolation, unknown>).left).toBeInstanceOf(
        SecretPolicyViolation
      );
    } finally {
      removePath(policyPath, { force: true });
    }
  });
});
