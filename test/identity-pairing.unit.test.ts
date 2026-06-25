import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { Identity, IdentityTest } from "../src/lib/effect/identity-service.ts";
import {
  MOCK_CLOCK_EPOCH,
  advanceSystemTime,
  utcSeconds,
  withSystemTime,
} from "./helpers/mock-clock.ts";

const TEST_JWT_SECRET = "test-jwt-secret-for-pairing";
const TEST_CSRF_SECRET = "test-csrf-secret-for-pairing";

function makeLayer() {
  return IdentityTest({
    jwtSecret: TEST_JWT_SECRET,
    csrfSecret: TEST_CSRF_SECRET,
  });
}

function run<A>(effect: Effect.Effect<A, any, Identity>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, makeLayer()));
}

describe("identity-pairing", () => {
  test("full auth flow: sign JWT, generate CSRF, verify both together", async () => {
    const userId = "user-pair-1";
    const result = await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        // Create session
        const session = yield* identity.createSession(userId);
        const sid = session.id;

        // Sign a JWT for this session
        const token = yield* identity.signToken({ sub: userId, sessionId: sid });

        // Generate CSRF token bound to session
        const csrf = yield* identity.generateCsrf(sid);

        // Verify JWT
        const verified = yield* identity.verifyToken(token);
        expect(verified.claims.sub).toBe(userId);

        // Verify CSRF
        yield* identity.verifyCsrf(csrf, sid);

        return { token, csrf, verified };
      })
    );

    expect(result.verified.claims.sub).toBe(userId);
  });

  test("CSRF token from one session fails for another session", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const session1 = yield* identity.createSession("user-a");
        const session2 = yield* identity.createSession("user-b");

        const csrf1 = yield* identity.generateCsrf(session1.id);

        // CSRF from session1 should fail for session2
        const result = yield* Effect.either(identity.verifyCsrf(csrf1, session2.id));

        expect(result._tag).toBe("Left");
      })
    );
  });

  test("JWT signed with one secret fails verification with another", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const token = yield* identity.signToken({ sub: "user1" });

        // Try to verify with a different secret via config
        const result = yield* Effect.either(
          identity.verifyToken(token, { secret: "wrong-secret" })
        );

        expect(result._tag).toBe("Left");
      })
    );
  });
});

describe("identity-service > JWT edge cases", () => {
  test("signToken with nbf in future fails verification", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      await run(
        Effect.gen(function* () {
          const identity = yield* Identity;

          const futureNbf = utcSeconds() + 3600;
          const token = yield* identity.signToken({
            sub: "user1",
            nbf: futureNbf,
          });

          const result = yield* Effect.either(identity.verifyToken(token));

          expect(result._tag).toBe("Left");
        })
      );
    });
  });

  test("signToken with very short TTL expires immediately", async () => {
    await withSystemTime(MOCK_CLOCK_EPOCH, async () => {
      await run(
        Effect.gen(function* () {
          const identity = yield* Identity;

          const token = yield* identity.signToken({ sub: "user1" }, { ttlSeconds: 1 });

          advanceSystemTime(1100, MOCK_CLOCK_EPOCH.getTime());

          const result = yield* Effect.either(identity.verifyToken(token));

          expect(result._tag).toBe("Left");
        })
      );
    });
  });

  test("decodeToken succeeds on valid token without verification", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const token = yield* identity.signToken({ sub: "user1", customClaim: "hello" });
        const decoded = yield* identity.decodeToken(token);

        expect(decoded.claims.sub).toBe("user1");
        expect(decoded.claims.customClaim).toBe("hello");
      })
    );
  });

  test("decodeToken fails on garbage input", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const result = yield* Effect.either(identity.decodeToken("not.a.jwt"));

        expect(result._tag).toBe("Left");
      })
    );
  });

  test("signToken preserves custom claims through round-trip", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const token = yield* identity.signToken({
          sub: "user1",
          role: "admin",
          scope: "read:all write:all",
          jti: "unique-id-123",
        });

        const verified = yield* identity.verifyToken(token);

        expect(verified.claims.role).toBe("admin");
        expect(verified.claims.scope).toBe("read:all write:all");
        expect(verified.claims.jti).toBe("unique-id-123");
      })
    );
  });
});

describe("identity-service > CSRF edge cases", () => {
  test("verifyCsrf succeeds for valid token with correct session", async () => {
    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const sid = "csrf-edge-1";
        const csrf = yield* identity.generateCsrf(sid);
        yield* identity.verifyCsrf(csrf, sid);
      })
    );
  });

  test("verifyCsrf fails for empty token", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const identity = yield* Identity;
          return yield* identity.verifyCsrf("", "session-1");
        }).pipe(
          Effect.sandbox,
          Effect.catchAll(() => Effect.succeed("caught" as const))
        ),
        makeLayer()
      )
    );

    expect(result).toBe("caught");
  });

  test("verifyCsrf fails for token from different secret", async () => {
    const otherLayer = IdentityTest({
      jwtSecret: TEST_JWT_SECRET,
      csrfSecret: "different-csrf-secret",
    });

    const csrfFromOther = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const id = yield* Identity;
          return yield* id.generateCsrf("session-x");
        }),
        otherLayer
      )
    );

    await run(
      Effect.gen(function* () {
        const identity = yield* Identity;

        const result = yield* Effect.either(identity.verifyCsrf(csrfFromOther, "session-x"));

        expect(result._tag).toBe("Left");
      })
    );
  });
});
