/**
 * Token CSRF handler — rotate/verify via src/lib/csrf.ts (Bun.CSRF).
 *
 * Endpoints:
 *   POST /api/token/csrf/rotate
 *   POST /api/token/csrf/verify
 *
 * @see ../../../../src/lib/csrf.ts
 */

import { resolveSessionIdFromRequest } from "../../../../src/lib/serve-session.ts";
import { generateCsrfToken, verifyCsrfToken } from "../../../../src/lib/csrf.ts";
import { SecretKeys } from "../../../../src/lib/secrets-constants.ts";
import { readSecretFromEnv } from "../../../../src/lib/secrets-env.ts";
import { jsonErrorResponse, jsonResponse } from "./shared.ts";

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const raw = await req.text();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const CSRF_DOMAIN = "identity-session" as const;
const DEV_CSRF_SECRET = "kimi-toolchain-dashboard-dev-secret"; // kimi-audit:ignore-hardcoded-secret

function sessionFromRequest(
  req: Request,
  bodySessionId?: string
): {
  sessionId: string;
  source: string;
} {
  if (bodySessionId?.trim()) {
    return { sessionId: bodySessionId.trim(), source: "body" };
  }
  const resolved = resolveSessionIdFromRequest(req);
  return { sessionId: resolved.sessionId, source: resolved.source };
}

function requireCsrfSecret(): string | Response {
  const secret =
    readSecretFromEnv(SecretKeys.CSRF_SECRET.service, SecretKeys.CSRF_SECRET.name) ??
    ((Bun.env.NODE_ENV ?? "").toLowerCase() === "production" ? null : DEV_CSRF_SECRET);
  if (secret === null) {
    return jsonErrorResponse({
      domain: CSRF_DOMAIN,
      code: "csrf_secret_missing",
      message: "CSRF_SECRET required in production",
      severity: "error",
    });
  }
  return secret;
}

async function apiCsrfRotate(req: Request): Promise<Response> {
  const body = (await readJson<Record<string, unknown>>(req)) ?? {};

  const secretOrRes = requireCsrfSecret();
  if (secretOrRes instanceof Response) return secretOrRes;
  const secret = secretOrRes;

  const { sessionId, source } = sessionFromRequest(req, body.sessionId as string | undefined);
  const expiresIn = (body.expiresIn as number) || 3600_000;

  const token = generateCsrfToken(secret, { sessionId, expiresIn });
  const valid = verifyCsrfToken(token, secret, { sessionId, maxAge: expiresIn });

  return jsonResponse({
    ok: true,
    token,
    sessionId,
    sessionSource: source,
    expiresIn,
    selfVerified: valid,
    algorithm: "sha256",
    encoding: "base64url",
    note: "CSRF token bound to sessionId (cookie session preferred). Include in X-CSRF-Token header on state-changing requests.",
  });
}

async function apiCsrfVerify(req: Request): Promise<Response> {
  const body = await readJson<{ token?: string; sessionId?: string }>(req);
  if (!body) {
    return jsonErrorResponse({
      domain: CSRF_DOMAIN,
      code: "json_body_required",
      message: "JSON body required with token and optional sessionId",
    });
  }

  if (!body.token?.trim()) {
    return jsonErrorResponse({
      domain: CSRF_DOMAIN,
      code: "token_required",
      message: "token field required",
    });
  }

  const secretOrRes = requireCsrfSecret();
  if (secretOrRes instanceof Response) return secretOrRes;
  const secret = secretOrRes;

  const { sessionId, source } = sessionFromRequest(req, body.sessionId);
  const valid = verifyCsrfToken(body.token, secret, { sessionId });

  return jsonResponse({
    ok: true,
    valid,
    token: body.token.slice(0, 20) + "...",
    sessionId,
    sessionSource: source,
    note: valid
      ? "Token is valid and not expired"
      : "Token is invalid, expired, or sessionId mismatch",
  });
}

export { apiCsrfRotate, apiCsrfVerify };
