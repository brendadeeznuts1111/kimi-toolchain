/**
 * secrets-metadata-macros.ts — Build-time generation of secrets metadata.
 *
 * When imported with `with { type: "macro" }`, these functions read
 * `secrets-constants.ts` at BUILD TIME and inline the result as a static
 * JSON object. This enables:
 *   - Zero-runtime-cost secret key lookup tables
 *   - Compile-time validation that all secrets are registered
 *   - Auto-generated resolver function names from the registry
 *
 * Usage:
 *   import { getSecretKeysMetadata, getResolverCount }
 *     from "./secrets-metadata-macros.ts" with { type: "macro" };
 *
 *   const metadata = getSecretKeysMetadata(); // inlined as static JSON
 */

import { SecretKeys } from "./secrets-constants.ts";

export interface SecretKeyMetadata {
  constName: string;
  service: string;
  name: string;
  envVar: string;
}

/**
 * Returns an array of all registered secret keys with metadata.
 * At build time, this becomes a static JSON array — no runtime import needed.
 */
export function getSecretKeysMetadata(): SecretKeyMetadata[] {
  return Object.entries(SecretKeys).map(([constName, key]) => ({
    constName,
    service: key.service,
    name: key.name,
    envVar: key.name.toUpperCase().replace(/-/g, "_"),
  }));
}

/**
 * Returns the count of registered secret keys.
 * At build time, this becomes a static number.
 */
export function getResolverCount(): number {
  return Object.keys(SecretKeys).length;
}

/**
 * Returns a list of service names from the registry.
 * At build time, this becomes a static string array.
 */
export function getRegisteredServices(): string[] {
  return [...new Set(Object.values(SecretKeys).map((k) => k.service))];
}
