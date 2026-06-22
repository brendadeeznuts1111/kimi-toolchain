/**
 * serve-identity.ts — Dashboard Identity + Secrets Effect layers.
 *
 * Composes IdentityLive over SecretsManager with demo fallbacks for local dev.
 */

import { Layer } from "effect";
import { IdentityLive } from "./effect/identity-service.ts";
import { SecretsTest } from "./effect/secrets-service.ts";
import { readSecretFromEnv } from "./secrets-env.ts";
import { SecretKeys } from "./secrets-constants.ts";
import type { SecretsBackend } from "./secrets-types.ts";
import { JwtMissingSecret } from "./effect/errors.ts";

const DEV_JWT_SECRET = "kimi-toolchain-jwt-dev-secret"; // kimi-audit:ignore-hardcoded-secret (intentional dev-only fallback)
const DEV_CSRF_SECRET = "kimi-toolchain-dashboard-dev-secret"; // kimi-audit:ignore-hardcoded-secret (intentional dev-only fallback)

function isProduction(): boolean {
  return (Bun.env.NODE_ENV ?? "").toLowerCase() === "production";
}

/** Bun.secrets → env aliases → dev fallback (non-production only). */
export function createDashboardSecretsBackend(): SecretsBackend {
  const bun = Bun.secrets;
  return {
    get: async ({ service, name }) => {
      try {
        const fromBun = await bun?.get({ service, name });
        if (fromBun?.trim()) return fromBun.trim();
      } catch {
        // fall through
      }

      const fromEnv = readSecretFromEnv(service, name);
      if (fromEnv) return fromEnv;

      if (!isProduction()) {
        if (service === SecretKeys.JWT_SECRET.service && name === SecretKeys.JWT_SECRET.name) {
          return DEV_JWT_SECRET;
        }
        if (service === SecretKeys.CSRF_SECRET.service && name === SecretKeys.CSRF_SECRET.name) {
          return DEV_CSRF_SECRET;
        }
      }

      return null;
    },
    set: async (opts) => {
      if (typeof bun?.set !== "function") return;
      await bun.set(opts);
    },
    delete: async (opts) => {
      if (typeof bun?.delete !== "function") return false;
      return bun.delete(opts);
    },
  };
}

export function dashboardIdentityLayer(projectRoot: string): Layer.Layer<import("./effect/identity-service.ts").Identity> {
  const secretsLayer = SecretsTest(createDashboardSecretsBackend(), { projectRoot });
  return Layer.provide(IdentityLive, secretsLayer);
}

// Runtime boundary lives in src/lib/effect/ so Effect.runPromise is permitted.
export { runDashboardIdentity } from "./effect/dashboard-identity-runtime.ts";

export function isJwtSecretMissingError(err: unknown): boolean {
  return err instanceof JwtMissingSecret;
}
