/**
 * jwt.ts — JWT signing and verification using Bun.CryptoHasher (HMAC-SHA256/384/512).
 *
 * Zero dependencies — uses `Bun.CryptoHasher` for fast, synchronous HMAC signing.
 * No async needed — signJwt and verifyJwt are now sync functions.
 *
 * @see https://bun.com/docs/runtime/hashing
 * @see identity-types.ts for type definitions
 * @see secrets-manager.ts for secret resolution
 */

import type {
  JwtClaims,
  JwtPayload,
  JwtConfig,
  JwtHeader,
  JwtError,
  VerifiedJwt,
} from "./identity-types.ts";
import { constantTimeEqual } from "./crypto-utils.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_ALGORITHM = "HS256" as const;
const DEFAULT_TTL_SECONDS = 3600;
const HMAC_ALGORITHMS = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
} as const;

// ── Base64URL ────────────────────────────────────────────────────────

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── HMAC via Bun.CryptoHasher ────────────────────────────────────────

function hmacSign(data: string, secret: string, algorithm: keyof typeof HMAC_ALGORITHMS): string {
  const hasher = new Bun.CryptoHasher(HMAC_ALGORITHMS[algorithm], secret);
  hasher.update(data);
  return hasher.digest("base64url");
}

function hmacVerify(
  data: string,
  signature: string,
  secret: string,
  algorithm: keyof typeof HMAC_ALGORITHMS
): boolean {
  const expected = hmacSign(data, secret, algorithm);
  return constantTimeEqual(signature, expected);
}

// ── JWT Sign ─────────────────────────────────────────────────────────

/**
 * Sign a JWT with the given claims and secret.
 *
 * @param claims - JWT claims (sub, exp, iat, etc.)
 * @param secret - HMAC secret (required if no config.secret)
 * @param config - Optional configuration for algorithm, issuer, etc.
 * @returns The signed JWT string (header.payload.signature)
 * @throws {"jwt_invalid_format"} If the algorithm is not supported
 */
export function signJwt(
  claims: JwtPayload & { sub: string },
  secret: string,
  config: JwtConfig = {}
): string {
  const algorithm = config.algorithm ?? DEFAULT_ALGORITHM;
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const fullClaims: JwtClaims = {
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + ttl,
    ...claims,
  };

  if (config.issuer && !fullClaims.iss) {
    fullClaims.iss = config.issuer;
  }
  if (config.audience && !fullClaims.aud) {
    fullClaims.aud = config.audience;
  }

  const header: JwtHeader = { alg: algorithm, typ: "JWT" };
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullClaims)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = hmacSign(signingInput, secret, algorithm);

  return `${signingInput}.${signature}`;
}

// ── JWT Verify ───────────────────────────────────────────────────────

/**
 * Verify a JWT and return the decoded claims.
 *
 * @param token - The JWT string to verify
 * @param secret - HMAC secret for verification
 * @param config - Optional configuration for issuer/audience validation
 * @returns Verified JWT with header, claims, and signature
 * @throws {"jwt_invalid_format"} If the token is not 3 parts or header/payload is malformed
 * @throws {"jwt_invalid_signature"} If the signature does not match or issuer/audience mismatch
 * @throws {"jwt_expired"} If the token has passed its expiration time
 * @throws {"jwt_not_yet_valid"} If the token is not yet valid (nbf claim)
 */
export function verifyJwt(token: string, secret: string, config: JwtConfig = {}): VerifiedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw { type: "jwt_invalid_format" } as { type: JwtError };
  }

  const [headerB64, payloadB64, signature] = parts;

  let header: JwtHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  } catch {
    throw { type: "jwt_invalid_format" } as { type: JwtError };
  }

  const algorithm = header.alg ?? DEFAULT_ALGORITHM;
  if (!(algorithm in HMAC_ALGORITHMS)) {
    throw { type: "jwt_invalid_format" } as { type: JwtError };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const valid = hmacVerify(signingInput, signature, secret, algorithm);
  if (!valid) {
    throw { type: "jwt_invalid_signature" } as { type: JwtError };
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    throw { type: "jwt_invalid_format" } as { type: JwtError };
  }

  const now = Math.floor(Date.now() / 1000);

  if (claims.nbf !== undefined && now < claims.nbf) {
    throw { type: "jwt_not_yet_valid" } as { type: JwtError };
  }

  if (claims.exp !== undefined && now >= claims.exp) {
    throw { type: "jwt_expired" } as { type: JwtError };
  }

  if (config.issuer && claims.iss !== config.issuer) {
    throw { type: "jwt_invalid_signature" } as { type: JwtError };
  }

  if (config.audience && claims.aud !== config.audience) {
    throw { type: "jwt_invalid_signature" } as { type: JwtError };
  }

  return { header, claims, signature };
}

// ── Convenience ──────────────────────────────────────────────────────

/**
 * Decode a JWT without verification (for inspection only).
 * DO NOT use this for authentication — always use `verifyJwt`.
 */
export function decodeJwt(token: string): { header: JwtHeader; claims: JwtClaims } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw { type: "jwt_invalid_format" } as { type: JwtError };
  }

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

  return { header, claims };
}

/**
 * Check if a JWT error is of a specific type.
 */
export function isJwtError(err: unknown, type: JwtError): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: string }).type === type
  );
}
