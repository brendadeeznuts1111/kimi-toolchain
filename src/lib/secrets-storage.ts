/**
 * secrets-storage.ts — Platform storage backend detection for Bun.secrets.
 *
 * macOS and Windows use OS-native encrypted stores with no plaintext fallback.
 * Linux requires libsecret; headless CI/containers fall back to plaintext env vars.
 *
 * @see docs/identity/secrets-registry.md for the platform matrix
 */

import { readableStreamToText } from "./bun-utils.ts";
import type { SecretPolicyEntry, StorageBackend, StorageSecurityLevel } from "./secrets-types.ts";

export const STORAGE_TIERS: readonly StorageBackend[] = [
  "keychain",
  "credential-manager",
  "libsecret",
  "env-fallback",
  "Bun.secrets",
] as const;

/** Whether the experimental Bun.secrets API is present in this runtime. */
export function isBunSecretsAvailable(): boolean {
  return typeof Bun.secrets === "object" && Bun.secrets !== null;
}

export function bunSecretsMethods(): { get: boolean; set: boolean; delete: boolean } {
  return {
    get: typeof Bun.secrets?.get === "function",
    set: typeof Bun.secrets?.set === "function",
    delete: typeof Bun.secrets?.delete === "function",
  };
}

export interface StorageStatus {
  platform: NodeJS.Platform;
  backend: StorageBackend;
  securityLevel: StorageSecurityLevel;
  secretToolPresent: boolean;
  libsecretAvailable: boolean;
  insecureSecretCount: number;
  envFallbackOptInCount: number;
  warnings: string[];
}

async function isLibsecretAvailable(): Promise<boolean> {
  const secretTool = Bun.which("secret-tool");
  if (!secretTool) return false;

  try {
    const versionProc = Bun.spawn([secretTool, "--version"], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await versionProc.exited) !== 0) return false;

    const probeProc = Bun.spawn([secretTool, "search", "--all", "x", "y"], {
      stdout: "ignore",
      stderr: "pipe",
    });
    await probeProc.exited;
    const stderr = await readableStreamToText(probeProc.stderr);
    if (
      stderr.includes("Cannot autolaunch") ||
      stderr.includes("Error communicating with daemon") ||
      stderr.includes("The name org.freedesktop.secrets was not provided")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Detect the active Bun.secrets storage backend for this process. */
export async function detectStorageBackend(): Promise<StorageBackend> {
  if (process.platform === "darwin") return "keychain";
  if (process.platform === "win32") return "credential-manager";
  return (await isLibsecretAvailable()) ? "libsecret" : "env-fallback";
}

/** Policy default when storageTier is omitted — platform-native secure tier. */
export function defaultStorageTierForPlatform(): StorageBackend {
  if (process.platform === "darwin") return "keychain";
  if (process.platform === "win32") return "credential-manager";
  return "libsecret";
}

export function effectiveStorageTier(entry: SecretPolicyEntry): StorageBackend {
  if (entry.storageTier === "Bun.secrets") {
    return defaultStorageTierForPlatform();
  }
  return entry.storageTier ?? defaultStorageTierForPlatform();
}

export function storageSecurityLevel(backend: StorageBackend): StorageSecurityLevel {
  return backend === "env-fallback" ? "low" : "high";
}

export function allowsEnvFallback(entry: SecretPolicyEntry): boolean {
  return effectiveStorageTier(entry) === "env-fallback";
}

export function isStorageTierMismatch(backend: StorageBackend, entry: SecretPolicyEntry): boolean {
  return backend === "env-fallback" && !allowsEnvFallback(entry);
}

export function countStorageTierMismatches(
  backend: StorageBackend,
  entries: Array<{ service: string; name: string; entry: SecretPolicyEntry }>
): number {
  return entries.filter(({ entry }) => isStorageTierMismatch(backend, entry)).length;
}

/** Block get() on storage tier mismatch when KIMI_SECRETS_STRICT_STORAGE=1. */
export function isStrictStorageEnabled(): boolean {
  return Bun.env.KIMI_SECRETS_STRICT_STORAGE === "1";
}

export function buildStorageStatus(
  backend: StorageBackend,
  entries: Array<{ service: string; name: string; entry: SecretPolicyEntry }>
): StorageStatus {
  const secretToolPresent = process.platform === "linux" && !!Bun.which("secret-tool");
  const libsecretAvailable = backend === "libsecret";
  const insecureSecretCount = countStorageTierMismatches(backend, entries);
  const envFallbackOptInCount = entries.filter(({ entry }) => allowsEnvFallback(entry)).length;
  const warnings: string[] = [];

  const general = envFallbackBackendWarning(backend);
  if (general) warnings.push(general);

  for (const { service, name, entry } of entries) {
    const perSecret = storageTierWarning(backend, entry, service, name);
    if (perSecret) warnings.push(perSecret);
  }

  return {
    platform: process.platform,
    backend,
    securityLevel: storageSecurityLevel(backend),
    secretToolPresent,
    libsecretAvailable,
    insecureSecretCount,
    envFallbackOptInCount,
    warnings,
  };
}

export function envFallbackBackendWarning(backend: StorageBackend): string | undefined {
  if (backend !== "env-fallback") return undefined;
  return (
    "Linux libsecret unavailable — Bun.secrets may use plaintext env vars (low security). " +
    'Set storageTier: "env-fallback" in secrets-policy.json5 for CI-only secrets.'
  );
}

export function storageTierWarning(
  backend: StorageBackend,
  entry: SecretPolicyEntry,
  service: string,
  name: string
): string | undefined {
  if (backend !== "env-fallback") return undefined;
  const expected = effectiveStorageTier(entry);
  if (expected === "env-fallback") return undefined;
  return (
    `${service}/${name}: Bun.secrets is using plaintext env fallback (libsecret unavailable); ` +
    `policy expects "${expected}"`
  );
}
