/**
 * Dashboard demo secret resolution — env override with dev fallback.
 */

import { SecretKeys } from "./secrets-constants.ts";
import { readSecretFromEnv } from "./secrets-env.ts";

const DEV_JWT_SECRET = "kimi-toolchain-jwt-dev-secret"; // kimi-audit:ignore-hardcoded-secret (intentional dev-only fallback)
const DEV_CSRF_SECRET = "kimi-toolchain-dashboard-dev-secret"; // kimi-audit:ignore-hardcoded-secret (intentional dev-only fallback)

function isProduction(): boolean {
  return (Bun.env.NODE_ENV ?? "").toLowerCase() === "production";
}

/** Resolve JWT signing secret; null when production requires JWT_SECRET. */
export function resolveJwtSecret(): string | null {
  const fromEnv = readSecretFromEnv(SecretKeys.JWT_SECRET.service, SecretKeys.JWT_SECRET.name);
  if (fromEnv) return fromEnv;
  if (isProduction()) return null;
  return DEV_JWT_SECRET;
}

/** Resolve CSRF secret; null when production requires CSRF_SECRET. */
export function resolveCsrfSecret(): string | null {
  const fromEnv = readSecretFromEnv(SecretKeys.CSRF_SECRET.service, SecretKeys.CSRF_SECRET.name);
  if (fromEnv) return fromEnv;
  if (isProduction()) return null;
  return DEV_CSRF_SECRET;
}
