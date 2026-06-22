/**
 * secrets-constants.ts — Canonical service and consumer name constants for Bun.secrets.
 *
 * All secret access must use these constants to prevent typos and enable
 * compile-time safety. The values here are the single source of truth for
 * what appears in secrets-policy.json5.
 *
 * @see docs/identity/secrets-registry.md for the human-readable registry
 * @see secrets-policy.json5 for rotation periods and allowed consumers
 * @see scripts/check-secrets-registry.ts for CI enforcement
 */

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
} as const;

export type ConsumerName = (typeof Consumers)[keyof typeof Consumers];

// ── Typed Secret Keys ─────────────────────────────────────────────────
// Convenience typed references for each known secret — use these instead
// of inline object literals in production code.

export const SecretKeys = {
  CLOUDFLARE_ACCOUNT_ID: { service: Services.KIMI_TOOLCHAIN, name: "cloudflare-account-id" },
  CLOUDFLARE_API_TOKEN:  { service: Services.KIMI_TOOLCHAIN, name: "cloudflare-api-token" },
  GITHUB_TOKEN:          { service: Services.CLI,            name: "github-token" },
  NPM_TOKEN:             { service: Services.CLI,            name: "npm-token" },
  BET365_API_KEY:        { service: Services.CLI,            name: "bet365-api-key" },
  CSRF_SECRET:           { service: Services.DASHBOARD,      name: "csrf-secret" },
  JWT_SECRET:            { service: Services.DASHBOARD,      name: "jwt-secret" },
  MASTER_KEY:            { service: Services.DASHBOARD,      name: "master-key" },
  SCANNER_API_KEY:       { service: Services.SECURITY,       name: "scanner-api-key" },
} as const satisfies Record<string, { service: ServiceName; name: string }>;
