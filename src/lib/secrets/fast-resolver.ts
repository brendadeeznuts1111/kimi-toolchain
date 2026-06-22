/**
 * fast-resolver.ts — Parallel Bun.secrets batch resolver with TTL cache.
 *
 * Resolves all SecretKeys concurrently via Promise.all (one keychain round-trip
 * pipeline) instead of sequential awaits.
 */

import { SecretKeys } from "../secrets-constants.ts";
import type { AnySecretKey, SecretsBackend } from "../secrets-types.ts";
import { isExpired, nowMs } from "../timing.ts";
import { validateSecretsAPI } from "./drift-guard.ts";

export const CACHE_TTL_MS = 30_000;

let cache: Map<string, string> | null = null;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
let cacheSinceMs = 0;

export function secretKeyId(key: AnySecretKey): string {
  return `${key.service}/${key.name}`;
}

export function parseSecretKeyId(id: string): { service: string; name: string } {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) {
    throw new Error(`Invalid secret key id: ${id}`);
  }
  return { service: id.slice(0, slash), name: id.slice(slash + 1) };
}

function scheduleCacheClear(): void {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cache = null;
    cacheTimer = null;
    cacheSinceMs = 0;
  }, CACHE_TTL_MS);
}

/** Batch-resolve secrets in parallel — one Promise.all() round-trip. */
export async function batchResolveSecrets(
  keys: readonly AnySecretKey[] = Object.values(SecretKeys),
  backend: SecretsBackend = Bun.secrets
): Promise<Map<string, string>> {
  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        const value = await backend.get({ service: key.service, name: key.name });
        return value ? ([secretKeyId(key), value] as const) : null;
      } catch {
        return null;
      }
    })
  );

  const map = new Map<string, string>();
  for (const entry of results) {
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

/** Cached lookup by `service/name` id — no keychain access after first batch. */
export async function getSecretFast(
  keyId: string,
  backend: SecretsBackend = Bun.secrets
): Promise<string | undefined> {
  if (!cache || isExpired(cacheSinceMs, CACHE_TTL_MS)) {
    cache = await batchResolveSecrets(undefined, backend);
    cacheSinceMs = nowMs();
    scheduleCacheClear();
  }
  return cache.get(keyId);
}

/** Boot-time resolver — all SecretKeys in one parallel batch. */
export async function resolveDevSecretsFast(
  backend: SecretsBackend = Bun.secrets
): Promise<Record<string, string | undefined>> {
  const map = await batchResolveSecrets(undefined, backend);
  const resolved: Record<string, string | undefined> = {};
  for (const key of Object.values(SecretKeys)) {
    resolved[secretKeyId(key)] = map.get(secretKeyId(key));
  }
  return resolved;
}

/** Explicit clear for rotation or security-sensitive operations. */
export function clearSecretCache(): void {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = null;
  cache = null;
}

/** Validate API shape then batch-resolve (call at CLI boot). */
export async function batchResolveSecretsValidated(
  keys?: readonly AnySecretKey[],
  backend?: SecretsBackend
): Promise<Map<string, string>> {
  validateSecretsAPI();
  return batchResolveSecrets(keys, backend);
}

// ── Benchmark utilities (Bun.nanoseconds for micro-benchmarks) ──

/** Measure a secrets operation with nanosecond precision. */
export async function measureSecrets<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Bun.nanoseconds();
  const result = await fn();
  const elapsedNs = Bun.nanoseconds() - t0;
  const elapsedMs = Number(elapsedNs) / 1_000_000;
  console.log(`[secrets] ${label}: ${elapsedMs.toFixed(3)}ms (${elapsedNs}ns)`);
  return result;
}

/** One-liner benchmark: batch resolve latency. */
export async function benchmarkBatchResolve(): Promise<void> {
  await measureSecrets("batchResolve", async () => {
    await batchResolveSecrets();
  });
}
