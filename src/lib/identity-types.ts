/**
 * identity-types.ts — Type definitions for the identity/auth layer.
 *
 * Covers JWT claims, session records, CSRF tokens, and configuration.
 *
 * @see jwt.ts for JWT signing/verification
 * @see session.ts for session management
 * @see csrf.ts for CSRF token generation
 */

// ── JWT Types ────────────────────────────────────────────────────────

export interface JwtHeader {
  alg: "HS256" | "HS384" | "HS512";
  typ: "JWT";
}

export interface JwtClaims {
  /** Subject (user ID). */
  sub: string;
  /** Issuer. */
  iss?: string;
  /** Audience. */
  aud?: string;
  /** Expiration time (seconds since epoch). */
  exp: number;
  /** Issued at (seconds since epoch). */
  iat: number;
  /** Not before (seconds since epoch). */
  nbf?: number;
  /** JWT ID (unique token identifier). */
  jti?: string;
  /** Custom claims. */
  [key: string]: unknown;
}

/** Input type for signJwt — iat/exp are optional (auto-filled by signer). */
export type JwtPayload = Omit<JwtClaims, "iat" | "exp"> & {
  iat?: number;
  exp?: number;
};

export interface JwtConfig {
  /** Secret used for HMAC signing. If not provided, uses SecretsManager. */
  secret?: string;
  /** Algorithm (default: HS256). */
  algorithm?: "HS256" | "HS384" | "HS512";
  /** Default issuer. */
  issuer?: string;
  /** Default audience. */
  audience?: string;
  /** Default token TTL in seconds (default: 3600 = 1 hour). */
  ttlSeconds?: number;
}

export interface VerifiedJwt {
  header: JwtHeader;
  claims: JwtClaims;
  signature: string;
}

// ── Session Types ────────────────────────────────────────────────────

export interface SessionRecord {
  /** Unique session ID. */
  id: string;
  /** User ID. */
  userId: string;
  /** Creation timestamp (ISO string). */
  createdAt: string;
  /** Expiration timestamp (ISO string). */
  expiresAt: string;
  /** Last activity timestamp (ISO string). */
  lastActivity: string;
  /** Session metadata (IP, user agent, etc.). */
  metadata?: Record<string, string>;
  /** Whether the session is active. */
  active: boolean;
}

export interface SessionConfig {
  /** Session TTL in seconds (default: 86400 = 24 hours). */
  ttlSeconds?: number;
  /** Idle timeout in seconds (default: 1800 = 30 minutes). */
  idleTimeoutSeconds?: number;
  /** Maximum concurrent sessions per user (default: 5). */
  maxSessionsPerUser?: number;
}

// ── CSRF Types ───────────────────────────────────────────────────────

/**
 * CSRF token object — used when you need metadata alongside the token string.
 * For the common case (stateless signed tokens via Bun.CSRF), use the raw
 * string returned by `generateCsrfToken()`.
 */
export interface CsrfToken {
  /** Token value. */
  value: string;
  /** Creation timestamp (ISO string). */
  createdAt: string;
  /** Expiration timestamp (ISO string). */
  expiresAt: string;
  /** Associated session ID (if any). */
  sessionId?: string;
}

export interface CsrfConfig {
  /** Token TTL in seconds (default: 3600 = 1 hour). */
  ttlSeconds?: number;
  /** Token length in bytes (default: 32). */
  tokenLength?: number;
}

// ── Errors ───────────────────────────────────────────────────────────

export type JwtError =
  | "jwt_expired"
  | "jwt_invalid_signature"
  | "jwt_invalid_format"
  | "jwt_not_yet_valid"
  | "jwt_missing_secret";

export type SessionError =
  | "session_not_found"
  | "session_expired"
  | "session_revoked"
  | "session_limit_exceeded";

export type CsrfError = "csrf_token_mismatch" | "csrf_token_expired" | "csrf_token_invalid";
