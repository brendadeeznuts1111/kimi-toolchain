/**
 * feature-flag-macros.ts — Macro functions for compile-time feature flags.
 *
 * These functions read environment variables at BUILD TIME. When imported
 * with `with { type: "macro" }`, the return values are inlined as static
 * booleans, enabling dead code elimination of disabled features.
 *
 * Usage:
 *   import { isScannerEnabled, isDashboardEnabled }
 *     from "./feature-flag-macros.ts" with { type: "macro" };
 *
 *   if (isScannerEnabled()) {
 *     // This entire block is eliminated if SCANNER_ENABLED != 1 at build time
 *   }
 */

function parseFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function isScannerEnabled(): boolean {
  return parseFlag(Bun.env.SCANNER_ENABLED ?? "1");
}

export function isIdentityEnabled(): boolean {
  return parseFlag(Bun.env.IDENTITY_ENABLED ?? "1");
}

export function isAuditEnabled(): boolean {
  return parseFlag(Bun.env.AUDIT_ENABLED ?? "1");
}

export function isDashboardEnabled(): boolean {
  return parseFlag(Bun.env.DASHBOARD_ENABLED ?? "0");
}

export function isSarifEnabled(): boolean {
  return parseFlag(Bun.env.SARIF_OUTPUT_ENABLED ?? "0");
}

export function isSbomEnabled(): boolean {
  return parseFlag(Bun.env.SBOM_ENABLED ?? "0");
}

export function isDebugEnabled(): boolean {
  return parseFlag(Bun.env.DEBUG_MODE ?? "0");
}
