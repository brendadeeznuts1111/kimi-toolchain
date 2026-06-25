/**
 * effect/identity-service.ts — Effect Context.Tag + Live/Test layers
 * for the identity layer (JWT + Session + CSRF).
 *
 * Depends on `Secrets` for HMAC secret resolution.
 * Follows the SecretsService pattern from secrets-service.ts.
 */

import { Context, Effect, Layer } from "effect";
import { signJwt, verifyJwt, decodeJwt } from "../jwt.ts";
import { SessionStore } from "../session.ts";
import { generateCsrfToken, verifyCsrfTokenDetailed } from "../csrf.ts";
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
  SecretPolicyViolation,
  type JwtError,
  type SessionError,
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
} from "../jwt.ts";

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
  ) => Effect.Effect<string, JwtMissingSecret | SecretPolicyViolation>;
  readonly verifyToken: (
    token: string,
    config?: JwtConfig
  ) => Effect.Effect<VerifiedJwt, JwtError | SecretPolicyViolation>;
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

  // ── CSRF ──
  readonly generateCsrf: (
    sessionId: string
  ) => Effect.Effect<string, JwtMissingSecret | SecretPolicyViolation>;
  readonly verifyCsrf: (
    token: string,
    sessionId: string
  ) => Effect.Effect<
    void,
    JwtMissingSecret | SecretPolicyViolation | CsrfTokenInvalid | CsrfTokenExpired
  >;
}

// ── Context Tag ──────────────────────────────────────────────────────

export class Identity extends Context.Tag("Identity")<Identity, IdentityService>() {}

// ── Helpers ──────────────────────────────────────────────────────────

function resolveJwtSecret(
  config: JwtConfig | undefined,
  secrets: SecretsService
): Effect.Effect<string, JwtMissingSecret | SecretPolicyViolation> {
  if (config?.secret) return Effect.succeed(config.secret);
  return secrets.get(JWT_SECRET_KEY, IDENTITY_SERVICE_CONSUMER).pipe(
    Effect.flatMap(
      (val): Effect.Effect<string, JwtMissingSecret> =>
        val === null
          ? Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
          : Effect.succeed(val)
    ),
    Effect.catchAll(
      (err): Effect.Effect<never, JwtMissingSecret | SecretPolicyViolation> =>
        err instanceof SecretPolicyViolation
          ? Effect.fail(err)
          : Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
    )
  );
}

function resolveCsrfSecret(
  secrets: SecretsService
): Effect.Effect<string, JwtMissingSecret | SecretPolicyViolation> {
  return secrets.get(CSRF_SECRET_KEY, IDENTITY_SERVICE_CONSUMER).pipe(
    Effect.flatMap(
      (val): Effect.Effect<string, JwtMissingSecret> =>
        val === null
          ? Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
          : Effect.succeed(val)
    ),
    Effect.catchAll(
      (err): Effect.Effect<never, JwtMissingSecret | SecretPolicyViolation> =>
        err instanceof SecretPolicyViolation
          ? Effect.fail(err)
          : Effect.fail(new JwtMissingSecret({ service: IDENTITY_SERVICE_CONSUMER }))
    )
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
    let csrfSecret: string | null = null;

    function getCsrfSecret(): Effect.Effect<string, JwtMissingSecret | SecretPolicyViolation> {
      if (csrfSecret) return Effect.succeed(csrfSecret);
      return resolveCsrfSecret(secrets).pipe(
        Effect.map((secret) => {
          csrfSecret = secret;
          return csrfSecret;
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

      // ── CSRF ──
      generateCsrf: (sessionId) =>
        Effect.gen(function* () {
          const secret = yield* getCsrfSecret();
          return generateCsrfToken(secret, { sessionId });
        }),

      verifyCsrf: (token, sessionId) =>
        Effect.gen(function* () {
          const secret = yield* getCsrfSecret();
          const result = verifyCsrfTokenDetailed(token, secret, { sessionId });
          if (!result.valid) {
            yield* Effect.fail(
              result.reason === "csrf_token_expired"
                ? new CsrfTokenExpired({ token })
                : new CsrfTokenInvalid({ token })
            );
          }
        }),
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
  const csrfTtlMs = (options.csrfConfig?.ttlSeconds ?? 3600) * 1000;

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

    generateCsrf: (sessionId) =>
      Effect.sync(() => generateCsrfToken(options.csrfSecret, { sessionId, expiresIn: csrfTtlMs })),

    verifyCsrf: (token, sessionId) => {
      const result = verifyCsrfTokenDetailed(token, options.csrfSecret, {
        sessionId,
        maxAge: csrfTtlMs,
      });
      if (result.valid) return Effect.void;
      return Effect.fail(
        result.reason === "csrf_token_expired"
          ? new CsrfTokenExpired({ token })
          : new CsrfTokenInvalid({ token })
      );
    },
  });
}
