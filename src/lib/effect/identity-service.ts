/**
 * effect/identity-service.ts — Effect Context.Tag + Live/Test layers
 * for the identity layer (JWT + Session + CSRF + password hashing).
 *
 * Depends on `Secrets` for HMAC secret resolution.
 * Follows the SecretsService pattern from secrets-service.ts.
 */

import { Context, Effect, Layer } from "effect";
import { signJwt, verifyJwt, decodeJwt } from "../jwt.ts";
import {
  SessionStore,
  sessionCookieHeader,
  parseSessionCookie,
  clearSessionCookie,
} from "../session.ts";
import { CsrfManager } from "../csrf.ts";
import { hashPassword, verifyPassword } from "../bun-utils.ts";
import { Secrets } from "./secrets-service.ts";
import type { SecretsService } from "./secrets-service.ts";
import {
  JwtExpired,
  JwtInvalidSignature,
  JwtInvalidFormat,
  JwtNotYetValid,
  JwtMissingSecret,
  SessionNotFound,
  CsrfTokenInvalid,
  CsrfTokenExpired,
  type JwtError,
  type SessionError,
  type CsrfError,
} from "./errors.ts";
import type {
  JwtPayload,
  JwtConfig,
  JwtClaims,
  JwtHeader,
  VerifiedJwt,
  SessionRecord,
  SessionConfig,
  CsrfConfig,
} from "../identity-types.ts";

import { SecretKeys, Consumers } from "../secrets-constants.ts";

// ── JWT Secret Key ───────────────────────────────────────────────────

const JWT_SECRET_KEY = SecretKeys.JWT_SECRET;
const CSRF_SECRET_KEY = SecretKeys.CSRF_SECRET;
const IDENTITY_SERVICE_CONSUMER = Consumers.IDENTITY_SERVICE;

// ── Service Interface ────────────────────────────────────────────────

export interface IdentityService {
  // ── JWT ──
  readonly signToken: (
    claims: JwtPayload & { sub: string },
    config?: JwtConfig
  ) => Effect.Effect<string, JwtMissingSecret>;
  readonly verifyToken: (token: string, config?: JwtConfig) => Effect.Effect<VerifiedJwt, JwtError>;
  readonly decodeToken: (
    token: string
  ) => Effect.Effect<{ header: JwtHeader; claims: JwtClaims }, JwtInvalidFormat>;

  // ── Session ──
  readonly createSession: (
    userId: string,
    metadata?: Record<string, string>
  ) => Effect.Effect<SessionRecord>;
  readonly getSession: (sessionId: string) => Effect.Effect<SessionRecord | null>;
  readonly verifySession: (
    sessionId: string,
    userId?: string
  ) => Effect.Effect<SessionRecord, SessionError>;
  readonly revokeSession: (sessionId: string) => Effect.Effect<boolean>;
  readonly revokeAllSessionsForUser: (userId: string) => Effect.Effect<number>;

  // ── Session Cookies ──
  readonly sessionCookie: (sessionId: string, config?: SessionConfig) => string;
  readonly parseSessionCookie: (cookieHeader: string | null) => string | null;
  readonly clearSessionCookie: () => string;

  // ── CSRF ──
  readonly generateCsrf: (sessionId: string) => Effect.Effect<string, JwtMissingSecret>;
  readonly verifyCsrf: (
    token: string,
    sessionId: string
  ) => Effect.Effect<void, JwtMissingSecret | CsrfTokenInvalid | CsrfTokenExpired>;

  // ── Password ──
  readonly hashPassword: (plain: string) => Effect.Effect<string>;
  readonly verifyPassword: (plain: string, hash: string) => Effect.Effect<boolean>;
}

// ── Context Tag ──────────────────────────────────────────────────────

export class Identity extends Context.Tag("Identity")<Identity, IdentityService>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function resolveJwtSecret(
  config: JwtConfig | undefined,
  secrets: SecretsService
): Effect.Effect<string, JwtMissingSecret> {
  if (config?.secret) return Effect.succeed(config.secret);
  return secrets.get(JWT_SECRET_KEY, IDENTITY_SERVICE_CONSUMER).pipe(
    Effect.flatMap((val) =>
      val === null
        ? Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
        : Effect.succeed(val)
    ),
    Effect.catchAll(() => Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER })))
  );
}

function resolveCsrfSecret(secrets: SecretsService): Effect.Effect<string, JwtMissingSecret> {
  return secrets.get(CSRF_SECRET_KEY, IDENTITY_SERVICE_CONSUMER).pipe(
    Effect.flatMap((val) =>
      val === null
        ? Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
        : Effect.succeed(val)
    ),
    Effect.catchAll(() => Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER })))
  );
}

function wrapJwtError(token: string, err: unknown): JwtError {
  if (typeof err === "object" && err !== null && "type" in err) {
    const type = (err as { type: string }).type;
    switch (type) {
      case "jwt_expired":
        return new JwtExpired({ token, exp: 0 });
      case "jwt_invalid_signature":
        return new JwtInvalidSignature({ token });
      case "jwt_invalid_format":
        return new JwtInvalidFormat({ token, reason: "malformed header or payload" });
      case "jwt_not_yet_valid":
        return new JwtNotYetValid({ token, nbf: 0 });
      case "jwt_missing_secret":
        return new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER });
    }
  }
  return new JwtInvalidFormat({ token, reason: String(err) });
}

// ── Live Layer ───────────────────────────────────────────────────────

export const IdentityLive = Layer.effect(
  Identity,
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const sessionStore = new SessionStore();
    let csrfManager: CsrfManager | null = null;

    function getCsrfManager(): Effect.Effect<CsrfManager, JwtMissingSecret> {
      if (csrfManager) return Effect.succeed(csrfManager);
      return resolveCsrfSecret(secrets).pipe(
        Effect.map((secret) => {
          csrfManager = new CsrfManager(secret);
          return csrfManager;
        })
      );
    }

    return {
      // ── JWT ──
      signToken: (claims, config = {}) =>
        Effect.gen(function* () {
          const secret = yield* resolveJwtSecret(config, secrets);
          return signJwt(claims, secret, config);
        }),

      verifyToken: (token, config = {}) =>
        Effect.gen(function* () {
          const secret = yield* resolveJwtSecret(config, secrets);
          return yield* Effect.try({
            try: () => verifyJwt(token, secret, config),
            catch: (err) => wrapJwtError(token, err),
          });
        }),

      decodeToken: (token) =>
        Effect.try({
          try: () => decodeJwt(token),
          catch: () => new JwtInvalidFormat({ token, reason: "malformed header or payload" }),
        }),

      // ── Session ──
      createSession: (userId, metadata) => Effect.sync(() => sessionStore.create(userId, metadata)),

      getSession: (sessionId) => Effect.sync(() => sessionStore.get(sessionId)),

      verifySession: (sessionId, userId) =>
        Effect.try({
          try: () => sessionStore.verify(sessionId, userId),
          catch: () => new SessionNotFound({ sessionId }),
        }),

      revokeSession: (sessionId) => Effect.sync(() => sessionStore.revoke(sessionId)),

      revokeAllSessionsForUser: (userId) =>
        Effect.sync(() => sessionStore.revokeAllForUser(userId)),

      // ── Session Cookies ──
      sessionCookie: (sessionId, config = {}) => sessionCookieHeader(sessionId, config),

      parseSessionCookie: (cookieHeader) => parseSessionCookie(cookieHeader),

      clearSessionCookie: () => clearSessionCookie(),

      // ── CSRF ──
      generateCsrf: (sessionId) =>
        Effect.gen(function* () {
          const mgr = yield* getCsrfManager();
          return mgr.generate(sessionId);
        }),

      verifyCsrf: (token, sessionId) =>
        Effect.gen(function* () {
          const mgr = yield* getCsrfManager();
          const result = mgr.verifyDetailed(token, sessionId);
          if (!result.valid) {
            yield* Effect.fail(
              result.reason === "csrf_token_expired"
                ? new CsrfTokenExpired({ token })
                : new CsrfTokenInvalid({ token })
            );
          }
        }),

      // ── Password ──
      hashPassword: (plain) => Effect.promise(() => hashPassword(plain)),

      verifyPassword: (plain, hash) => Effect.promise(() => verifyPassword(plain, hash)),
    } satisfies IdentityService;
  })
);

// ── Test Layer ───────────────────────────────────────────────────────

export function IdentityTest(options: {
  jwtSecret: string;
  csrfSecret: string;
  sessionConfig?: SessionConfig;
  csrfConfig?: CsrfConfig;
}): Layer.Layer<Identity> {
  const sessionStore = new SessionStore(options.sessionConfig);
  const csrfManager = new CsrfManager(options.csrfSecret, options.csrfConfig);

  return Layer.succeed(Identity, {
    signToken: (claims, config = {}) =>
      Effect.sync(() => signJwt(claims, config.secret ?? options.jwtSecret, config)),

    verifyToken: (token, config = {}) =>
      Effect.try({
        try: () => verifyJwt(token, config.secret ?? options.jwtSecret, config),
        catch: (err) => wrapJwtError(token, err),
      }),

    decodeToken: (token) =>
      Effect.try({
        try: () => decodeJwt(token),
        catch: () => new JwtInvalidFormat({ token, reason: "malformed" }),
      }),

    createSession: (userId, metadata) => Effect.sync(() => sessionStore.create(userId, metadata)),

    getSession: (sessionId) => Effect.sync(() => sessionStore.get(sessionId)),

    verifySession: (sessionId, userId) =>
      Effect.try({
        try: () => sessionStore.verify(sessionId, userId),
        catch: () => new SessionNotFound({ sessionId }),
      }),

    revokeSession: (sessionId) => Effect.sync(() => sessionStore.revoke(sessionId)),

    revokeAllSessionsForUser: (userId) => Effect.sync(() => sessionStore.revokeAllForUser(userId)),

    sessionCookie: (sessionId, config = {}) => sessionCookieHeader(sessionId, config),

    parseSessionCookie: (cookieHeader) => parseSessionCookie(cookieHeader),

    clearSessionCookie: () => clearSessionCookie(),

    generateCsrf: (sessionId) => Effect.sync(() => csrfManager.generate(sessionId)),

    verifyCsrf: (token, sessionId) => {
      const result = csrfManager.verifyDetailed(token, sessionId);
      if (result.valid) return Effect.void;
      return Effect.fail(
        result.reason === "csrf_token_expired"
          ? new CsrfTokenExpired({ token })
          : new CsrfTokenInvalid({ token })
      );
    },

    hashPassword: (plain) => Effect.promise(() => hashPassword(plain)),

    verifyPassword: (plain, hash) => Effect.promise(() => verifyPassword(plain, hash)),
  });
}
