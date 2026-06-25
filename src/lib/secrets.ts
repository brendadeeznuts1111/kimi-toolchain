/**
 * Domain-scoped Bun.secrets wrapper for factory-wager integrations.
 *
 * Service namespace: com.factory-wager.<domain>
 * Local development only — use env fallback on CI/production servers.
 *
 * @see https://bun.com/docs/runtime/secrets
 * @see secrets-manager.ts for policy-enforced kimi-toolchain secrets
 */

import { secrets } from "bun";
import { readSecretFromEnv } from "./secrets-env.ts";
import { isBunSecretsAvailable } from "./secrets-storage.ts";
import type { SecretsBackend } from "./secrets-constants.ts";

/** Reverse-DNS prefix for domain-scoped OS credential store entries. */
export const FACTORY_WAGER_SERVICE_PREFIX = "com.factory-wager";

export type FactoryWagerDomain = "sportsbook" | "payments" | "risk" | "webhooks" | "alerts";

export interface DomainSecretOptions {
  env?: Record<string, string | undefined>;
  backend?: SecretsBackend;
}

export function domainService(domain: string): string {
  return `${FACTORY_WAGER_SERVICE_PREFIX}.${domain}`;
}

function resolveBackend(opts?: DomainSecretOptions): SecretsBackend | null {
  if (opts?.backend) return opts.backend;
  return isBunSecretsAvailable() ? secrets : null;
}

/**
 * Read a domain secret from Bun.secrets, falling back to env when unset.
 * Env key: COM_FACTORY_WAGER_<DOMAIN>_<NAME> (see secrets-env.secretEnvKey).
 */
export async function getSecret(
  domain: string,
  name: string,
  opts?: DomainSecretOptions
): Promise<string | null> {
  const service = domainService(domain);
  const backend = resolveBackend(opts);
  const env = opts?.env ?? Bun.env;

  if (backend) {
    try {
      const value = await backend.get({ service, name });
      if (value != null && value !== "") return value;
    } catch {
      // fall through to env
    }
  }

  return readSecretFromEnv(service, name, env);
}

export async function setSecret(
  domain: string,
  name: string,
  value: string,
  opts?: Pick<DomainSecretOptions, "backend">
): Promise<void> {
  const backend = resolveBackend(opts);
  if (!backend?.set) {
    throw new Error("Bun.secrets.set unavailable — cannot store domain secrets");
  }
  await backend.set({ service: domainService(domain), name, value });
}

export async function deleteSecret(
  domain: string,
  name: string,
  opts?: Pick<DomainSecretOptions, "backend">
): Promise<boolean> {
  const backend = resolveBackend(opts);
  if (!backend?.delete) return false;
  return backend.delete({ service: domainService(domain), name });
}
