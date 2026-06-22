/**
 * Token JWT handler — sign/verify/revoke via src/lib/jwt.ts (HMAC-SHA256).
 *
 * Endpoints:
 *   POST /api/token/jwt/sign
 *   POST /api/token/jwt/verify
 *   POST /api/token/jwt/revoke
 *
 * @see ../../../../src/lib/jwt.ts
 */

import {
  resolveSessionIdFromRequest,
  resolveUserIdFromRequest,
} from "../../../../src/lib/serve-session.ts";
import { structuredErrorFields } from "../../../../src/lib/error-format.ts";
import { decodeJwt, isJwtError, signJwt, verifyJwt } from "../../../../src/lib/jwt.ts";
import { resolveJwtSecret } from "../../../../src/lib/serve-secrets.ts";
import { jsonErrorResponse, jsonResponse } from "./shared.ts";

interface ReadableBody {
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}

function asReadable(req: Request): ReadableBody {
  return req as unknown as ReadableBody;
}

async function readJson<T>(req: ReadableBody): Promise<T | null> {
  try {
    const raw = await req.text();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const revokedTokens = new Set<string>();
const REVOKE_CLEANUP_INTERVAL = 300_000;
let lastCleanup = Date.now();

function cleanupExpiredRevocations(): void {
  if (Date.now() - lastCleanup > REVOKE_CLEANUP_INTERVAL) {
    if (revokedTokens.size > 1000) revokedTokens.clear();
    lastCleanup = Date.now();
  }
}

const JWT_DOMAIN = "identity-jwt" as const;

function requireJwtSecret(): string | Response {
  const secret = resolveJwtSecret();
  if (!secret) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "jwt_secret_missing",
      message: "JWT_SECRET required in production",
      severity: "error",
    });
  }
  return secret;
}

async function apiJwtSign(req: Request): Promise<Response> {
  const body = await readJson<{
    sub?: string;
    payload?: Record<string, unknown>;
    expiresIn?: number;
  }>(asReadable(req));
  if (!body) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "json_body_required",
      message: "JSON body required",
    });
  }

  const secretOrRes = requireJwtSecret();
  if (secretOrRes instanceof Response) return secretOrRes;
  const secret = secretOrRes;

  const cookieUserId = resolveUserIdFromRequest(req);
  const { sessionId, source: sessionSource } = resolveSessionIdFromRequest(req);
  const sub = body.sub?.trim() || cookieUserId || "dashboard-user";
  const expiresIn = body.expiresIn || 3600_000;
  const ttlSeconds = Math.max(1, Math.floor(expiresIn / 1000));

  const token = signJwt(
    {
      sub,
      sid: sessionId,
      jti: crypto.randomUUID(),
      ...body.payload,
    },
    secret,
    { ttlSeconds }
  );

  const { header, claims } = decodeJwt(token);

  return jsonResponse({
    ok: true,
    token,
    header,
    payload: claims,
    expiresIn,
    sessionSource,
    cookieUserId: cookieUserId ?? null,
    note: "JWT signed with HMAC-SHA256 (src/lib/jwt.ts). sub defaults to cookie user id when present; sid binds session.",
  });
}

async function apiJwtVerify(req: Request): Promise<Response> {
  const body = await readJson<{ token?: string }>(asReadable(req));
  if (!body) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "json_body_required",
      message: "JSON body required with token field",
    });
  }

  const token = body.token?.trim();
  if (!token) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "token_required",
      message: "token field required",
    });
  }

  const secretOrRes = requireJwtSecret();
  if (secretOrRes instanceof Response) return secretOrRes;
  const secret = secretOrRes;

  if (token.split(".").length !== 3) {
    return jsonResponse({
      ok: true,
      valid: false,
      error: "Malformed JWT: expected 3 parts",
      ...structuredErrorFields({
        domain: JWT_DOMAIN,
        code: "jwt_malformed",
        message: "Malformed JWT: expected 3 parts",
        severity: "warn",
      }),
    });
  }

  try {
    const verified = verifyJwt(token, secret);
    const payload = verified.claims;

    cleanupExpiredRevocations();
    if (payload.jti && revokedTokens.has(payload.jti)) {
      return jsonResponse({
        ok: true,
        valid: false,
        reason: "Token revoked",
        ...structuredErrorFields({
          domain: JWT_DOMAIN,
          code: "jwt_revoked",
          message: "Token revoked",
          severity: "warn",
        }),
        jti: payload.jti,
      });
    }

    const { sessionId, source } = resolveSessionIdFromRequest(req);
    const sid = typeof payload.sid === "string" ? payload.sid : undefined;

    return jsonResponse({
      ok: true,
      valid: true,
      payload: {
        sub: payload.sub,
        sid,
        iat: payload.iat,
        exp: payload.exp,
        jti: payload.jti,
      },
      sessionAligned: sid ? sid === sessionId : undefined,
      sessionSource: source,
      note: "JWT is valid — signature matches, not expired, not revoked.",
    });
  } catch (err) {
    if (isJwtError(err, "jwt_invalid_signature")) {
      return jsonResponse({
        ok: true,
        valid: false,
        reason: "Invalid signature",
        ...structuredErrorFields({
          domain: JWT_DOMAIN,
          code: "jwt_signature_invalid",
          message: "Invalid signature",
          severity: "warn",
        }),
        note: "Token signature does not match — tampered or signed with different secret.",
      });
    }

    if (isJwtError(err, "jwt_expired")) {
      let payload: { sub?: unknown; iat?: unknown; exp?: unknown } = {};
      try {
        payload = decodeJwt(token).claims;
      } catch {
        // ignore decode errors for error response
      }
      return jsonResponse({
        ok: true,
        valid: false,
        reason: "Token expired",
        ...structuredErrorFields({
          domain: JWT_DOMAIN,
          code: "jwt_expired",
          message: "Token expired",
          severity: "warn",
        }),
        payload: { sub: payload.sub, iat: payload.iat, exp: payload.exp },
        expiredAt:
          typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined,
      });
    }

    if (isJwtError(err, "jwt_invalid_format")) {
      return jsonResponse({
        ok: true,
        valid: false,
        error: "Malformed JWT",
        ...structuredErrorFields({
          domain: JWT_DOMAIN,
          code: "jwt_malformed",
          message: "Malformed JWT",
          severity: "warn",
        }),
      });
    }

    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "jwt_verify_failed",
      message: "JWT verification failed",
    });
  }
}

async function apiJwtRevoke(req: Request): Promise<Response> {
  const body = await readJson<{ token?: string }>(asReadable(req));
  if (!body) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "json_body_required",
      message: "JSON body required with token field",
    });
  }

  const token = body.token?.trim();
  if (!token) {
    return jsonErrorResponse({
      domain: JWT_DOMAIN,
      code: "token_required",
      message: "token field required",
    });
  }

  let jti: string | undefined;
  try {
    jti = decodeJwt(token).claims.jti;
  } catch {
    // ignore malformed tokens — revoke by token prefix
  }

  const revokeKey = jti ?? token.slice(0, 64);
  revokedTokens.add(revokeKey);

  return jsonResponse({
    ok: true,
    revoked: true,
    jti: revokeKey,
    note: "Token added to revocation denylist.",
  });
}

export { apiJwtSign, apiJwtVerify, apiJwtRevoke };
