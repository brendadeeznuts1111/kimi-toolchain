/**
 * secrets-types.ts — Type definitions for the Bun.secrets integration layer.
 *
 * SecretKey is derived from SecretKeys in secrets-constants.ts — the two are
 * always in sync. DynamicSecretKey is the escape hatch for unregistered or
 * dynamically-discovered secrets.
 *
 * @see secrets-constants.ts for the canonical registry of service/consumer names
 */

import type { SecretKeys } from "./secrets-constants.ts";

/** Union of all statically-known secret keys, derived from SecretKeys constant. */
export type SecretKey = (typeof SecretKeys)[keyof typeof SecretKeys];

export type DynamicSecretKey = { service: string; name: string };

export type AnySecretKey = SecretKey | DynamicSecretKey;

/** OS storage tier for Bun.secrets — see docs/identity/secrets-registry.md. */
export type StorageBackend = "keychain" | "credential-manager" | "libsecret" | "env-fallback";

export type StorageSecurityLevel = "high" | "low";

export type SecretResolveSource = "bun.secrets" | "env";

export interface SecretPolicyEntry {
  allowedConsumers: string[];
  rotationDays: number;
  lastRotated: string | null;
  version: number;
  /** Explicit storage tier; omit for platform-native secure default. */
  storageTier?: StorageBackend;
  expiresAt?: string | null;
  environments?: {
    [env: string]: Partial<Omit<SecretPolicyEntry, "environments">>;
  };
}

export interface SecretsPolicyDocument {
  $schema: "v1";
  [service: string]: Record<string, SecretPolicyEntry> | "v1";
}

export interface SecretAuditRecord {
  timestamp: string;
  action: "get" | "set" | "delete" | "rotate" | "check";
  service: string;
  name: string;
  consumer: string;
  success: boolean;
  errorReason?: string;
  stale?: boolean;
  daysStale?: number | null;
  version?: number;
  traceId?: string;
  storageBackend?: StorageBackend;
  resolvedVia?: SecretResolveSource;
}

export interface SecretsBackend {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

export interface ValidationResult<T> {
  ok: boolean;
  errors: string[];
  value?: T;
}

export interface SecretCheckResult {
  key: AnySecretKey;
  status: "ok" | "missing" | "stale" | "unregistered" | "storage_mismatch";
  daysStale?: number | null;
  lastRotated?: string | null;
  rotationDays?: number;
  storageTier?: StorageBackend;
  storageWarning?: string;
  resolvedVia?: SecretResolveSource;
  storageMismatch?: boolean;
}

export interface SecretListResult {
  key: AnySecretKey;
  present: boolean;
  policy: SecretPolicyEntry | null;
  resolvedVia?: SecretResolveSource;
}

export interface AuditQuery {
  since?: string;
  consumer?: string;
  service?: string;
  name?: string;
  action?: "get" | "set" | "delete" | "rotate" | "check";
}
