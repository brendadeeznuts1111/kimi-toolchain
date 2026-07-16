/**
 * secrets-constants.ts — Canonical service and consumer name constants for Bun.secrets.
 *
 * All secret access must use these constants to prevent typos and enable
 * compile-time safety. The values here are the single source of truth for
 * what appears in secrets-policy.json5.
 *
 * @see docs/identity/secrets-registry.md for the human-readable registry
 * @see secrets-policy.json5 for rotation periods and allowed consumers
 * @see scripts/lint-registry.ts --secret for CI enforcement
 */

export const SECRETS_POLICY_FILE = "secrets-policy.json5";
export const SECRETS_REGISTRY_DOC = "docs/identity/secrets-registry.md";

// ── Service Names ─────────────────────────────────────────────────────
// Reverse-domain format: <top-level>.<org>.<component>[.<sub-component>]
// Rule: never include environment or version suffixes here.
// Use the `environments` field in secrets-policy.json5 for per-env overrides.

export const Services = {
  /** Legacy: migrated from cloudflare-access.ts hardcoded constants. */
  KIMI_TOOLCHAIN: "kimi-toolchain",
  /** CLI tools: kimi-fix, kimi-doctor, kimi-guardian, kimi-secrets. */
  CLI: "com.herdr.cli",
  /** Main web dashboard and HTTP server. */
  DASHBOARD: "com.herdr.dashboard",
  /** Security scanner and vulnerability pipeline. */
  SECURITY: "com.herdr.security",
  /** CI/CD runners — env-fallback tier only. */
  CI: "com.herdr.ci",
  /** Release signing pipeline (GitHub Actions). */
  RELEASE: "com.herdr.release",
  /** Archive baseline storage (R2-backed sync/restore). */
  ARCHIVE: "com.kimi-toolchain.archive",
  /** Release SSOT metadata fetch and verification. */
  RELEASE_SSOT: "com.kimi-toolchain.release",
  /** Herdr remote WebSocket proxy (unix-socket forwarded TLS). */
  HERDR_REMOTE_WS: "com.herdr.remote-ws",
} as const;

export type ServiceName = (typeof Services)[keyof typeof Services];

// ── Consumer Names ────────────────────────────────────────────────────
// Rules:
//   - lowercase kebab-case
//   - descriptive of the role, not the component
//   - no top-level domain or org prefix

export const Consumers = {
  /** kimi-cloudflare-access CLI tool. */
  CLOUDFLARE_ACCESS: "kimi-cloudflare-access",
  /** kimi-doctor diagnostic CLI. */
  KIMI_DOCTOR: "kimi-doctor",
  /** kimi-fix automated repair CLI. */
  KIMI_FIX: "kimi-fix",
  /** Main herdr HTTP server. */
  HERDR_SERVER: "herdr-server",
  /** Named webhook handlers. */
  WEBHOOK_NAMED: "webhook:named",
  /** Identity service (JWT + CSRF + session). */
  IDENTITY_SERVICE: "identity-service",
  /** Security scanning pipeline. */
  SCANNER_PIPELINE: "bun-install",
  /** Generic CLI tool consumer (CI runners). */
  CLI_TOOL: "cli-tool",
  /** GitHub Actions workflow runner. */
  GITHUB_ACTIONS: "github-actions",
  /** Local release build script consumer. */
  LOCAL_BUILD_SCRIPT: "local-build-script",
  /** Archive baseline sync consumer. */
  SYNC_BASELINE: "sync-baseline",
  /** Archive baseline restore consumer. */
  RESTORE_BASELINE: "restore-baseline",
  /** head-table-typed.ts release metadata extraction. */
  HEAD_TABLE_TYPED: "head-table-typed",
  /** Release SSOT verification gate. */
  RELEASE_VERIFY: "release-verify",
  /** Herdr remote WebSocket proxy consumer. */
  HERDR_WS_UNIX: "herdr-ws-unix",
} as const;

export type ConsumerName = (typeof Consumers)[keyof typeof Consumers];

// ── Typed Secret Keys ─────────────────────────────────────────────────
// Convenience typed references for each known secret — use these instead
// of inline object literals in production code.

export const SecretKeys = {
  CLOUDFLARE_ACCOUNT_ID: { service: Services.KIMI_TOOLCHAIN, name: "cloudflare-account-id" },
  CLOUDFLARE_API_TOKEN: { service: Services.KIMI_TOOLCHAIN, name: "cloudflare-api-token" },
  GITHUB_TOKEN: { service: Services.CLI, name: "github-token" },
  GITHUB_API_DOMAIN: { service: Services.CLI, name: "github-api-domain" },
  NPM_TOKEN: { service: Services.CLI, name: "npm-token" },
  BET365_API_KEY: { service: Services.CLI, name: "bet365-api-key" },
  R2_ACCESS_KEY_ID: { service: Services.CLI, name: "r2-access-key-id" },
  R2_SECRET_ACCESS_KEY: { service: Services.CLI, name: "r2-secret-access-key" },
  DISCORD_WEBHOOK_URL: { service: Services.CLI, name: "discord-webhook-url" },
  TELEGRAM_BOT_TOKEN: { service: Services.CLI, name: "telegram-bot-token" },
  CSRF_SECRET: { service: Services.DASHBOARD, name: "csrf-secret" },
  JWT_SECRET: { service: Services.DASHBOARD, name: "jwt-secret" },
  MASTER_KEY: { service: Services.DASHBOARD, name: "master-key" },
  SCANNER_API_KEY: { service: Services.SECURITY, name: "scanner-api-key" },
  CI_GITHUB_TOKEN: { service: Services.CI, name: "github-token" },
  BUN_RELEASE_SIGNING_KEY: {
    service: Services.RELEASE,
    name: "bun-release-signing-key",
  },
  R2_ARCHIVE_BUCKET: {
    service: Services.ARCHIVE,
    name: "r2-archive-bucket",
  },
  R2_ARCHIVE_ENDPOINT: {
    service: Services.ARCHIVE,
    name: "r2-archive-endpoint",
  },
  GITHUB_RELEASE_TOKEN: {
    service: Services.RELEASE_SSOT,
    name: "github-release-token",
  },
  HERDR_PROXY_CERT: {
    service: Services.HERDR_REMOTE_WS,
    name: "herdr-proxy-cert",
  },
} as const satisfies Record<string, { service: ServiceName; name: string }>;

export type SecretKey = (typeof SecretKeys)[keyof typeof SecretKeys];
export type DynamicSecretKey = { service: string; name: string };
export type AnySecretKey = SecretKey | DynamicSecretKey;
export type StorageBackend =
  | "keychain"
  | "credential-manager"
  | "libsecret"
  | "env-fallback"
  | "Bun.secrets";
export type StorageSecurityLevel = "high" | "low";
export type SecretResolveSource = "bun.secrets" | "env";

export interface SecretPolicyEntry {
  allowedConsumers: string[];
  rotationDays: number;
  lastRotated: string | null;
  version: number;
  storageTier?: StorageBackend;
  expiresAt?: string | null;
  environments?: { [env: string]: Partial<Omit<SecretPolicyEntry, "environments">> };
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
