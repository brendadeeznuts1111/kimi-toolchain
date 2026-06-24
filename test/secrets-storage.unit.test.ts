import { describe, expect, test } from "bun:test";
import {
  STORAGE_TIERS,
  allowsEnvFallback,
  buildStorageStatus,
  defaultStorageTierForPlatform,
  effectiveStorageTier,
  envFallbackBackendWarning,
  isStorageTierMismatch,
  storageSecurityLevel,
  storageTierWarning,
} from "../src/lib/secrets-storage.ts";
import { validateSecretsPolicy } from "../src/lib/secrets-policy.ts";
import type { SecretPolicyEntry } from "../src/lib/secrets-types.ts";

describe("secrets-storage", () => {
  test("STORAGE_TIERS lists all platform backends", () => {
    expect(STORAGE_TIERS).toEqual([
      "keychain",
      "credential-manager",
      "libsecret",
      "env-fallback",
      "Bun.secrets",
    ]);
  });

  test("defaultStorageTierForPlatform matches current platform", () => {
    if (process.platform === "darwin") {
      expect(defaultStorageTierForPlatform()).toBe("keychain");
    } else if (process.platform === "win32") {
      expect(defaultStorageTierForPlatform()).toBe("credential-manager");
    } else {
      expect(defaultStorageTierForPlatform()).toBe("libsecret");
    }
  });

  test("envFallbackBackendWarning only fires for env-fallback backend", () => {
    expect(envFallbackBackendWarning("env-fallback")).toContain("libsecret unavailable");
    expect(envFallbackBackendWarning("keychain")).toBeUndefined();
  });

  test("storageTierWarning flags secure-tier secrets on env-fallback backend", () => {
    const entry: SecretPolicyEntry = {
      allowedConsumers: ["identity-service"],
      rotationDays: 30,
      lastRotated: null,
      version: 1,
    };
    expect(
      storageTierWarning("env-fallback", entry, "com.herdr.dashboard", "jwt-secret")
    ).toContain("policy expects");
    expect(
      storageTierWarning(
        "env-fallback",
        { ...entry, storageTier: "env-fallback" },
        "com.herdr.ci",
        "github-token"
      )
    ).toBeUndefined();
  });

  test("effectiveStorageTier honors explicit policy tier", () => {
    const entry: SecretPolicyEntry = {
      allowedConsumers: ["cli-tool"],
      rotationDays: 1,
      lastRotated: null,
      version: 1,
      storageTier: "env-fallback",
    };
    expect(effectiveStorageTier(entry)).toBe("env-fallback");
  });

  test("allowsEnvFallback only when policy tier is env-fallback", () => {
    const entry: SecretPolicyEntry = {
      allowedConsumers: ["cli-tool"],
      rotationDays: 1,
      lastRotated: null,
      version: 1,
      storageTier: "env-fallback",
    };
    expect(allowsEnvFallback(entry)).toBe(true);
    expect(isStorageTierMismatch("env-fallback", entry)).toBe(false);
    expect(storageSecurityLevel("keychain")).toBe("high");
    expect(storageSecurityLevel("env-fallback")).toBe("low");
  });

  test("buildStorageStatus aggregates mismatch warnings", () => {
    const entry: SecretPolicyEntry = {
      allowedConsumers: ["identity-service"],
      rotationDays: 30,
      lastRotated: null,
      version: 1,
    };
    const status = buildStorageStatus("env-fallback", [
      { service: "com.herdr.dashboard", name: "jwt-secret", entry },
    ]);
    expect(status.insecureSecretCount).toBe(1);
    expect(status.warnings.length).toBeGreaterThan(0);
  });

  test("validateSecretsPolicy rejects unknown storageTier", () => {
    const result = validateSecretsPolicy({
      $schema: "v1",
      "com.herdr.ci": {
        "github-token": {
          allowedConsumers: ["cli-tool"],
          rotationDays: 1,
          lastRotated: null,
          version: 1,
          storageTier: "plaintext-file",
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("storageTier"))).toBe(true);
  });
});
