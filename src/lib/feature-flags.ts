/**
 * feature-flags.ts — Compile-time feature flags via Bun macros.
 *
 * Feature flags are resolved at BUILD TIME by reading environment variables.
 * Disabled features are eliminated from the bundle via dead code elimination.
 *
 * Usage:
 *   import { features } from "./feature-flags.ts";
 *
 *   if (features.scanner) {
 *     // This code is included only if SCANNER_ENABLED=1 at build time
 *   }
 *
 * Build-time configuration:
 *   SCANNER_ENABLED=1     Enable scanner pipeline (default: 1)
 *   IDENTITY_ENABLED=1    Enable identity layer (default: 1)
 *   AUDIT_ENABLED=1       Enable audit trail (default: 1)
 *   DASHBOARD_ENABLED=0   Enable dashboard frontend (default: 0)
 *   SARIF_OUTPUT_ENABLED=0 Enable SARIF output format (default: 0)
 *   SBOM_ENABLED=0        Enable SBOM generation (default: 0)
 *   DEBUG_MODE=0          Enable debug features (default: 0)
 */

// ── Macro Functions ──────────────────────────────────────────────────

function readFlag(key: string, fallback: string): string {
  return Bun.env[key] ?? fallback;
}

// ── Feature Flag Resolution ──────────────────────────────────────────

// Note: We can't use macro import for readFlag because the argument is
// dynamically constructed. Instead, we read env vars at module load time.
// When bundled, these become static values frozen at build time.

const flagScanner = Bun.env.SCANNER_ENABLED ?? "1";
const flagIdentity = Bun.env.IDENTITY_ENABLED ?? "1";
const flagAudit = Bun.env.AUDIT_ENABLED ?? "1";
const flagDashboard = Bun.env.DASHBOARD_ENABLED ?? "0";
const flagSarif = Bun.env.SARIF_OUTPUT_ENABLED ?? "0";
const flagSbom = Bun.env.SBOM_ENABLED ?? "0";
const flagDebug = Bun.env.DEBUG_MODE ?? "0";

// ── Exported Feature Flags ───────────────────────────────────────────

export const features = {
  scanner: flagScanner === "1" || flagScanner === "true",
  identity: flagIdentity === "1" || flagIdentity === "true",
  audit: flagAudit === "1" || flagAudit === "true",
  dashboard: flagDashboard === "1" || flagDashboard === "true",
  sarifOutput: flagSarif === "1" || flagSarif === "true",
  sbom: flagSbom === "1" || flagSbom === "true",
  debug: flagDebug === "1" || flagDebug === "true",
} as const;

export type Features = typeof features;

// ── Feature Flag Metadata ────────────────────────────────────────────

export interface FeatureFlagInfo {
  name: string;
  envVar: string;
  enabled: boolean;
  description: string;
}

export const featureInfo: FeatureFlagInfo[] = [
  {
    name: "scanner",
    envVar: "SCANNER_ENABLED",
    enabled: features.scanner,
    description: "Vulnerability scanner pipeline",
  },
  {
    name: "identity",
    envVar: "IDENTITY_ENABLED",
    enabled: features.identity,
    description: "Identity and session management",
  },
  {
    name: "audit",
    envVar: "AUDIT_ENABLED",
    enabled: features.audit,
    description: "Secret access audit trail",
  },
  {
    name: "dashboard",
    envVar: "DASHBOARD_ENABLED",
    enabled: features.dashboard,
    description: "Dashboard frontend",
  },
  {
    name: "sarifOutput",
    envVar: "SARIF_OUTPUT_ENABLED",
    enabled: features.sarifOutput,
    description: "SARIF output format for scanner",
  },
  { name: "sbom", envVar: "SBOM_ENABLED", enabled: features.sbom, description: "SBOM generation" },
  { name: "debug", envVar: "DEBUG_MODE", enabled: features.debug, description: "Debug features" },
];
