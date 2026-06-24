/**
 * secrets-env.ts — Canonical env-var mapping for env-fallback storage tier.
 *
 * Used when libsecret is unavailable (headless Linux CI). Only secrets with
 * storageTier: "env-fallback" in secrets-policy.json5 are read from env.
 */

import { SecretKeys } from "./secrets-constants.ts";

/** Derive env var from service/name: com.herdr.ci/github-token → COM_HERDR_CI_GITHUB_TOKEN */
export function secretEnvKey(service: string, name: string): string {
  return `${service}/${name}`
    .toUpperCase()
    .replace(/-/g, "_")
    .replace(/\./g, "_")
    .replace(/\//g, "_");
}

/** Well-known short aliases (CLOUDFLARE_API_TOKEN, JWT_SECRET, etc.). */
const ENV_ALIASES: Record<string, readonly string[]> = {
  [`${SecretKeys.CLOUDFLARE_ACCOUNT_ID.service}:${SecretKeys.CLOUDFLARE_ACCOUNT_ID.name}`]: [
    "CLOUDFLARE_ACCOUNT_ID",
  ],
  [`${SecretKeys.CLOUDFLARE_API_TOKEN.service}:${SecretKeys.CLOUDFLARE_API_TOKEN.name}`]: [
    "CLOUDFLARE_API_TOKEN",
  ],
  [`${SecretKeys.JWT_SECRET.service}:${SecretKeys.JWT_SECRET.name}`]: ["JWT_SECRET"],
  [`${SecretKeys.CSRF_SECRET.service}:${SecretKeys.CSRF_SECRET.name}`]: ["CSRF_SECRET"],
  [`${SecretKeys.GITHUB_TOKEN.service}:${SecretKeys.GITHUB_TOKEN.name}`]: [
    "GITHUB_TOKEN",
    "GH_TOKEN",
  ],
  [`${SecretKeys.CI_GITHUB_TOKEN.service}:${SecretKeys.CI_GITHUB_TOKEN.name}`]: [
    "GITHUB_TOKEN",
    "GH_TOKEN",
  ],
  [`${SecretKeys.NPM_TOKEN.service}:${SecretKeys.NPM_TOKEN.name}`]: [
    "NPM_TOKEN",
    "NPM_CONFIG_TOKEN",
  ],
  [`${SecretKeys.BUN_RELEASE_SIGNING_KEY.service}:${SecretKeys.BUN_RELEASE_SIGNING_KEY.name}`]: [
    "BUN_RELEASE_SIGNING_KEY",
  ],
};

export function secretEnvCandidates(service: string, name: string): string[] {
  const canonical = secretEnvKey(service, name);
  const aliases = ENV_ALIASES[`${service}:${name}`] ?? [];
  return [canonical, ...aliases.filter((a) => a !== canonical)];
}

export function readSecretFromEnv(
  service: string,
  name: string,
  env: Record<string, string | undefined> = Bun.env
): string | null {
  for (const key of secretEnvCandidates(service, name)) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}
