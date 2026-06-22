/**
 * secrets-types.ts — Type definitions for the Bun.secrets integration layer.
 *
 * SecretKey is a discriminated union of all known secrets, providing
 * compile-time exhaustiveness checking. DynamicSecretKey is the escape
 * hatch for unregistered or dynamically-discovered secrets.
 */

export type SecretKey =
  | { service: "kimi-toolchain"; name: "cloudflare-account-id" }
  | { service: "kimi-toolchain"; name: "cloudflare-api-token" }
  | { service: "com.herdr.cli"; name: "github-token" }
  | { service: "com.herdr.cli"; name: "npm-token" }
  | { service: "com.herdr.cli"; name: "bet365-api-key" }
  | { service: "com.herdr.dashboard"; name: "csrf-secret" }
  | { service: "com.herdr.dashboard"; name: "jwt-secret" }
  | { service: "com.herdr.dashboard"; name: "master-key" }
  | { service: "com.herdr.security"; name: "scanner-api-key" };

export type DynamicSecretKey = { service: string; name: string };

export type AnySecretKey = SecretKey | DynamicSecretKey;

export interface SecretPolicyEntry {
  allowedConsumers: string[];
  rotationDays: number;
  lastRotated: string | null;
  version: number;
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
  status: "ok" | "missing" | "stale" | "unregistered";
  daysStale?: number | null;
  lastRotated?: string | null;
  rotationDays?: number;
}

export interface SecretListResult {
  key: AnySecretKey;
  present: boolean;
  policy: SecretPolicyEntry | null;
}

export interface AuditQuery {
  since?: string;
  consumer?: string;
  service?: string;
  name?: string;
  action?: "get" | "set" | "delete" | "rotate" | "check";
}
