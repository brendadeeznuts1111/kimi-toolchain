/**
 * csrf.ts — CSRF token generation and verification using Bun.CSRF.
 *
 * Bun provides a built-in stateless CSRF API that signs tokens with a
 * secret key — no server-side store needed. This module wraps it with
 * our config types and SecretsManager integration for secret resolution.
 *
 * Features:
 *   - Stateless signed tokens (no in-memory store required)
 *   - Session ID binding
 *   - TTL-based expiration
 *   - Multiple algorithms (sha256, sha384, sha512, blake2b256, blake2b512)
 *   - Multiple encodings (base64url, base64, hex)
 *
 * @see https://bun.com/docs/runtime/csrf
 * @see jwt.ts for type definitions
 */

import type { CsrfError } from "./jwt.ts";
import { constantTimeEqual } from "./crypto-utils.ts";

export { constantTimeEqual };

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 3600 * 1000;
const DEFAULT_ALGORITHM = "sha256" as const;
const DEFAULT_ENCODING = "base64url" as const;

export type CsrfAlgorithm =
  | "sha256"
  | "sha384"
  | "sha512"
  | "sha512-256"
  | "blake2b256"
  | "blake2b512";

export type CsrfEncoding = "base64" | "base64url" | "hex";

export interface CsrfGenerateOptions {
  /** Session ID — REQUIRED to bind token to this user/session. */
  sessionId: string;
  expiresIn?: number;
  algorithm?: CsrfAlgorithm;
  encoding?: CsrfEncoding;
}

export interface CsrfVerifyOptions {
  /** Session ID — REQUIRED to bind token to this user/session. */
  sessionId: string;
  maxAge?: number;
  algorithm?: CsrfAlgorithm;
  encoding?: CsrfEncoding;
}

export type CsrfFailureReason = "csrf_token_invalid" | "csrf_token_expired";

export interface CsrfVerifyResult {
  valid: boolean;
  reason?: CsrfFailureReason;
}

// ── Token Generation ─────────────────────────────────────────────────

/**
 * Generate a CSRF token using Bun.CSRF.generate().
 *
 * Session binding: appends sessionId to the secret so tokens are
 * cryptographically bound to a specific session. Without sessionId,
 * a token is only bound to the secret — any token the server has ever
 * issued validates for every user, enabling cross-user replay attacks.
 *
 * @param secret - HMAC secret (required for stateless verification)
 * @param options - Required: sessionId. Optional: expiresIn, algorithm, encoding
 * @returns Signed CSRF token string
 */
export function generateCsrfToken(secret: string, options: CsrfGenerateOptions): string {
  const effectiveSecret = `${secret}:${options.sessionId}`;

  return Bun.CSRF.generate(effectiveSecret, {
    expiresIn: options.expiresIn ?? DEFAULT_TTL_MS,
    algorithm: options.algorithm ?? DEFAULT_ALGORITHM,
    encoding: options.encoding ?? DEFAULT_ENCODING,
    sessionId: options.sessionId,
  } as Parameters<typeof Bun.CSRF.generate>[1]);
}

/**
 * Verify a CSRF token using Bun.CSRF.verify().
 *
 * @param token - The token string to verify
 * @param secret - HMAC secret (must match the one used to generate)
 * @param options - Required: sessionId. Optional: maxAge, algorithm, encoding
 * @returns true if valid, false otherwise
 */
export function verifyCsrfToken(
  token: string,
  secret: string,
  options: CsrfVerifyOptions
): boolean {
  return verifyCsrfTokenDetailed(token, secret, options).valid;
}

/**
 * Verify a CSRF token and return a detailed result with failure reason.
 *
 * Bun.CSRF.verify() returns only boolean, so we use a two-step diagnostic:
 *   1. Normal verify with the caller's maxAge
 *   2. If it fails, retry with unlimited maxAge — if it passes, the token
 *      is structurally valid but expired
 *
 * @returns { valid: true } or { valid: false, reason: "csrf_token_expired" | "csrf_token_invalid" }
 */
export function verifyCsrfTokenDetailed(
  token: string,
  secret: string,
  options: CsrfVerifyOptions
): CsrfVerifyResult {
  if (!token || token.length < 10) {
    return { valid: false, reason: "csrf_token_invalid" };
  }

  const effectiveSecret = `${secret}:${options.sessionId}`;
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;
  const encoding = options.encoding ?? DEFAULT_ENCODING;

  const verifyOpts = {
    secret: effectiveSecret,
    algorithm,
    encoding,
    sessionId: options.sessionId,
  } as Parameters<typeof Bun.CSRF.verify>[1];

  if (Bun.CSRF.verify(token, { ...verifyOpts, maxAge: options.maxAge })) {
    return { valid: true };
  }

  if (Bun.CSRF.verify(token, { ...verifyOpts, maxAge: Number.MAX_SAFE_INTEGER })) {
    return { valid: false, reason: "csrf_token_expired" };
  }

  return { valid: false, reason: "csrf_token_invalid" };
}

// ── Throwing Variant ─────────────────────────────────────────────────

/**
 * Verify a CSRF token, throwing a typed CsrfError on failure.
 *
 * @throws {CsrfError} If token is invalid or expired
 */
export function verifyCsrfTokenOrThrow(
  token: string,
  secret: string,
  options: CsrfVerifyOptions
): void {
  const result = verifyCsrfTokenDetailed(token, secret, options);
  if (!result.valid) {
    throw { type: result.reason ?? "csrf_token_invalid" } as { type: CsrfError };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Check if an error is a CsrfError of a specific type.
 */
export function isCsrfError(err: unknown, type: CsrfError): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: string }).type === type
  );
}
