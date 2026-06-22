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
 * @see identity-types.ts for type definitions
 */

import type { CsrfConfig, CsrfError } from "./identity-types.ts";
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
  const effectiveSecret = `${secret}:${options.sessionId}`;

  return Bun.CSRF.verify(token, {
    secret: effectiveSecret,
    maxAge: options.maxAge,
    algorithm: options.algorithm ?? DEFAULT_ALGORITHM,
    encoding: options.encoding ?? DEFAULT_ENCODING,
    sessionId: options.sessionId,
  } as Parameters<typeof Bun.CSRF.verify>[1]);
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
  const valid = verifyCsrfToken(token, secret, options);
  if (!valid) {
    throw { type: "csrf_token_invalid" } as { type: CsrfError };
  }
}

// ── Config Wrapper ───────────────────────────────────────────────────

/**
 * Config-based CSRF helper. Stores secret and defaults so callers
 * don't need to pass them on every call.
 */
export class CsrfManager {
  private readonly secret: string;
  private readonly config: Required<CsrfConfig> & {
    algorithm: CsrfAlgorithm;
    encoding: CsrfEncoding;
  };

  constructor(
    secret: string,
    config: CsrfConfig & {
      algorithm?: CsrfAlgorithm;
      encoding?: CsrfEncoding;
    } = {}
  ) {
    this.secret = secret;
    this.config = {
      ttlSeconds: config.ttlSeconds ?? 3600,
      tokenLength: config.tokenLength ?? 32,
      algorithm: config.algorithm ?? DEFAULT_ALGORITHM,
      encoding: config.encoding ?? DEFAULT_ENCODING,
    };
  }

  generate(sessionId: string): string {
    return generateCsrfToken(this.secret, {
      sessionId,
      expiresIn: this.config.ttlSeconds * 1000,
      algorithm: this.config.algorithm,
      encoding: this.config.encoding,
    });
  }

  verify(token: string, sessionId: string): boolean {
    return verifyCsrfToken(token, this.secret, {
      sessionId,
      maxAge: this.config.ttlSeconds * 1000,
      algorithm: this.config.algorithm,
      encoding: this.config.encoding,
    });
  }

  verifyOrThrow(token: string, sessionId: string): void {
    if (!this.verify(token, sessionId)) {
      throw { type: "csrf_token_invalid" } as { type: CsrfError };
    }
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
