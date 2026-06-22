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
import { resolveCsrfSecret } from "../../../../src/lib/serve-secrets.ts";
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

const CSRF_DOMAIN = "identity-session" as const;

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
  const secret = resolveCsrfSecret();
  if (!secret) {
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
  const r = asReadable(req);
  const body = (await readJson<Record<string, unknown>>(r)) ?? {};

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
  const r = asReadable(req);
  const body = await readJson<{ token?: string; sessionId?: string }>(r);
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
