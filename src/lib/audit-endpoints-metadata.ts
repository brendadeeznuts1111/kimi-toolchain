/**
 * Audit + verify endpoint catalog — CLI scripts and dashboard HTTP routes with metadata.
 */

import { DASHBOARD_STATIC_ROUTES } from "../../examples/dashboard/src/handlers/routes.ts";
import {
  DASHBOARD_ARTIFACT_EXACT_PATHS,
  DASHBOARD_ARTIFACT_PATTERN_PATHS,
} from "./dashboard-route-inventory.ts";

export type AuditEndpointKind = "cli" | "http";

export type AuditEndpointLayer =
  | "secrets"
  | "config"
  | "network"
  | "images"
  | "bundle"
  | "verify"
  | "doctor"
  | "identity"
  | "runtime"
  | "templates";

export interface AuditEndpointMeta {
  /** Stable id (kebab-case). */
  id: string;
  kind: AuditEndpointKind;
  /** package.json script name or HTTP path. */
  path: string;
  /** Entry script under repo or handler module. */
  entry: string;
  httpMethods?: readonly string[];
  layer: AuditEndpointLayer;
  dryRun: boolean;
  /** Exits non-zero on drift when run full (not dry-run). */
  strictBlocks: boolean;
  verifyCheckId?: string;
  description: string;
  dashboardCard?: string;
  /** Hand-curated audit/doctor/identity surface (vs auto-generated from route table). */
  curated?: boolean;
}

export const AUDIT_CLI_ENDPOINTS: readonly AuditEndpointMeta[] = [
  {
    id: "audit-secrets",
    kind: "cli",
    path: "audit:secrets",
    entry: "scripts/scan-secret-leaks.ts",
    layer: "secrets",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.audit:secrets",
    description: "Raw secret-style env access scan (auditSecretLeaks)",
  },
  {
    id: "audit-config",
    kind: "cli",
    path: "audit:config",
    entry: "scripts/config-status.ts",
    layer: "config",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.audit:config",
    description: "Configuration layer gates (canonical-references, manifest, parity, bun-install)",
    dashboardCard: "card-config-status",
  },
  {
    id: "audit-images",
    kind: "cli",
    path: "audit:images",
    entry: "scripts/audit-images.ts",
    layer: "images",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.audit:images",
    description: "Image asset entropy / metadata scan",
  },
  {
    id: "audit-network",
    kind: "cli",
    path: "audit:network",
    entry: "scripts/audit-network.ts",
    layer: "network",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.audit:network",
    description: "NO_PROXY bypass verification for internal URLs",
  },
  {
    id: "audit-all",
    kind: "cli",
    path: "audit:all",
    entry: "scripts/audit-all.ts",
    layer: "bundle",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.audit:all",
    description: "Parallel secret + isolation + image + kimi-config audit bundle",
  },
  {
    id: "audit-perf",
    kind: "cli",
    path: "audit:perf",
    entry: "scripts/audit-all.ts",
    layer: "bundle",
    dryRun: true,
    strictBlocks: true,
    description: "Alias to audit-all (cpu-prof friendly)",
  },
  {
    id: "audit-bundle",
    kind: "cli",
    path: "audit",
    entry: "package.json#audit",
    layer: "bundle",
    dryRun: false,
    strictBlocks: true,
    description: "Parallel audit:secrets + audit:config + audit:images + audit:network",
  },
  {
    id: "audit-dry-run-bundle",
    kind: "cli",
    path: "audit:dry-run",
    entry: "package.json#audit:dry-run",
    layer: "bundle",
    dryRun: true,
    strictBlocks: false,
    verifyCheckId: "audit.bundle.dry-run",
    description: "Parallel dry-run for all audit scripts + audit:all",
  },
  {
    id: "config-status",
    kind: "cli",
    path: "config:status",
    entry: "scripts/config-status.ts",
    layer: "config",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.config.gates",
    description: "Same gates as audit:config — JSON via --json",
  },
  {
    id: "canvas-generate",
    kind: "cli",
    path: "canvas:generate",
    entry: "scripts/generate-canvas-companions.ts",
    layer: "config",
    dryRun: false,
    strictBlocks: true,
    verifyCheckId: "canvas.companions",
    description: "Regenerate CANVAS_ROUTING and hub stats; --check for freshness gate",
  },
  {
    id: "check-template-policy",
    kind: "cli",
    path: "check:template-policy",
    entry: "scripts/check-template-policy.ts",
    layer: "templates",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.check:template-policy",
    description: "Template bunfig.toml [install] policy parity with root",
  },
  {
    id: "check-templates",
    kind: "cli",
    path: "check:templates",
    entry: "scripts/check-templates.ts",
    layer: "templates",
    dryRun: true,
    strictBlocks: true,
    verifyCheckId: "audit.check:templates",
    description: "bun-create registry alignment, zero-deps, postinstall, trustedDependencies",
  },
  {
    id: "check-secret-leaks",
    kind: "cli",
    path: "check:secret-leaks",
    entry: "scripts/scan-secret-leaks.ts",
    layer: "secrets",
    dryRun: false,
    strictBlocks: true,
    description: "CI gate alias for scan-secret-leaks",
  },
  {
    id: "check-secret-resolution",
    kind: "cli",
    path: "check:secret-resolution",
    entry: "test/doctor-secret-isolation.unit.test.ts",
    layer: "secrets",
    dryRun: false,
    strictBlocks: true,
    description: "Bin spawn-before-resolve isolation gate",
  },
  {
    id: "verify-bun-features",
    kind: "cli",
    path: "verify:bun-features",
    entry: "scripts/verify-bun-features.ts",
    layer: "verify",
    dryRun: false,
    strictBlocks: false,
    description: "Bun-native ritual — dry-run audits + optional strict config",
  },
  {
    id: "verify-bun-features-strict",
    kind: "cli",
    path: "verify:bun-features:strict",
    entry: "scripts/verify-bun-features.ts --strict",
    layer: "verify",
    dryRun: false,
    strictBlocks: true,
    description: "verify:bun-features with audit:config alignment",
  },
  {
    id: "doctor-audit",
    kind: "cli",
    path: "doctor:audit",
    entry: "src/doctor/**/*.test.ts",
    layer: "doctor",
    dryRun: false,
    strictBlocks: true,
    description: "bun test src/doctor --parallel --isolate",
  },
  {
    id: "autophagy-scan",
    kind: "cli",
    path: "autophagy:scan",
    entry: "scripts/autophagy-scan.ts",
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Unused export / dead-code scan (advisory in check:fast when script present)",
  },
  {
    id: "autophagy-scan-gate",
    kind: "cli",
    path: "autophagy:scan:gate",
    entry: "scripts/autophagy-scan.ts --exit-code",
    layer: "doctor",
    dryRun: false,
    strictBlocks: true,
    description: "Autophagy scan with non-zero exit on findings",
  },
  {
    id: "deep-audit",
    kind: "cli",
    path: "deep-audit",
    entry: "src/bin/kimi-deep-audit.ts",
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Deep audit CLI — JSON report to .kimi-artifacts/",
  },
  {
    id: "check-secrets-registry",
    kind: "cli",
    path: "check:secrets-registry",
    entry: "scripts/check-secrets-registry.ts",
    layer: "secrets",
    dryRun: false,
    strictBlocks: true,
    description: "Secrets registry lint gate",
  },
  {
    id: "check-secrets-storage-gate",
    kind: "cli",
    path: "check:secrets-storage-gate",
    entry: "scripts/secrets-storage-gate.ts",
    layer: "secrets",
    dryRun: false,
    strictBlocks: true,
    description: "Secrets storage policy gate",
  },
] as const;

/** Hand-curated HTTP endpoints (audit, doctor, identity, config probes). */
export const AUDIT_HTTP_CURATED: readonly AuditEndpointMeta[] = [
  {
    id: "http-config-status",
    kind: "http",
    path: "/api/config-status",
    entry: "examples/dashboard/src/handlers/config-status.ts",
    httpMethods: ["GET"],
    layer: "config",
    dryRun: false,
    strictBlocks: true,
    description: "auditConfigLayersStatus JSON + fetchedAt",
    dashboardCard: "card-config-status",
  },
  {
    id: "http-secrets",
    kind: "http",
    path: "/api/secrets",
    entry: "examples/dashboard/src/handlers/api-handlers.ts",
    httpMethods: ["GET"],
    layer: "secrets",
    dryRun: false,
    strictBlocks: false,
    description: "Secrets registry card probe surface",
    dashboardCard: "card-secrets",
  },
  {
    id: "http-gates",
    kind: "http",
    path: "/api/gates",
    entry: "examples/dashboard/src/handlers/api-handlers.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Execution gate registry",
    dashboardCard: "card-gates",
  },
  {
    id: "http-kimi-doctor",
    kind: "http",
    path: "/api/kimi-doctor",
    entry: "examples/dashboard/src/handlers/kimi-doctor.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "kimi-doctor subprocess probe",
    dashboardCard: "card-kimi-doctor",
  },
  {
    id: "http-color",
    kind: "http",
    path: "/api/color",
    entry: "examples/dashboard/src/handlers/color.ts",
    httpMethods: ["GET"],
    layer: "runtime",
    dryRun: false,
    strictBlocks: false,
    description: "Bun.color hex/HEX/hsl + ANSI conversions",
    dashboardCard: "card-color",
  },
  {
    id: "http-trace-verify",
    kind: "http",
    path: "/api/trace-verify",
    entry: "examples/dashboard/src/handlers/trace-verify.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Trace ledger verification probe",
  },
  {
    id: "http-identity-flow",
    kind: "http",
    path: "/api/identity/flow",
    entry: "examples/dashboard/src/handlers/identity-flow.ts",
    httpMethods: ["GET"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "Identity pairing / token flow card",
    dashboardCard: "card-identity-flow",
  },
  {
    id: "http-tokens",
    kind: "http",
    path: "/api/tokens",
    entry: "examples/dashboard/src/handlers/token-discovery.ts",
    httpMethods: ["GET"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "Token discovery inventory",
  },
  {
    id: "http-cookies",
    kind: "http",
    path: "/api/cookies",
    entry: "examples/dashboard/src/handlers/token-cookies.ts",
    httpMethods: ["GET"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "Serve cookie policy surface",
  },
  {
    id: "http-token-csrf-rotate",
    kind: "http",
    path: "/api/token/csrf/rotate",
    entry: "examples/dashboard/src/handlers/token-csrf.ts",
    httpMethods: ["POST"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "CSRF token rotation",
  },
  {
    id: "http-token-csrf-verify",
    kind: "http",
    path: "/api/token/csrf/verify",
    entry: "examples/dashboard/src/handlers/token-csrf.ts",
    httpMethods: ["POST"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "CSRF token verification",
  },
  {
    id: "http-token-jwt-sign",
    kind: "http",
    path: "/api/token/jwt/sign",
    entry: "examples/dashboard/src/handlers/token-jwt.ts",
    httpMethods: ["POST"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "JWT sign probe",
  },
  {
    id: "http-token-jwt-verify",
    kind: "http",
    path: "/api/token/jwt/verify",
    entry: "examples/dashboard/src/handlers/token-jwt.ts",
    httpMethods: ["POST"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "JWT verify probe",
  },
  {
    id: "http-toolchain-health",
    kind: "http",
    path: "/api/toolchain/health",
    entry: "examples/dashboard/src/handlers/api-handlers.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Toolchain health aggregate",
    curated: true,
  },
  {
    id: "http-token-jwt-revoke",
    kind: "http",
    path: "/api/token/jwt/revoke",
    entry: "examples/dashboard/src/handlers/token-jwt.ts",
    httpMethods: ["POST"],
    layer: "identity",
    dryRun: false,
    strictBlocks: false,
    description: "JWT revoke probe",
    curated: true,
  },
  {
    id: "http-trace-ledger",
    kind: "http",
    path: "/api/trace-ledger",
    entry: "examples/dashboard/src/handlers/trace-ledger.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Trace ledger card surface",
    curated: true,
  },
  {
    id: "http-serve-metrics",
    kind: "http",
    path: "/api/serve-metrics",
    entry: "examples/dashboard/src/handlers/serve-metrics.ts",
    httpMethods: ["GET"],
    layer: "doctor",
    dryRun: false,
    strictBlocks: false,
    description: "Bun.serve metrics probe",
    curated: true,
  },
] as const;

/** @deprecated Use DASHBOARD_HTTP_ENDPOINTS for full catalog; AUDIT_HTTP_CURATED for audit focus. */
export const AUDIT_HTTP_ENDPOINTS = AUDIT_HTTP_CURATED;

function httpPathToId(path: string): string {
  return `http-${path
    .replace(/^\//, "")
    .replace(/\//g, "-")
    .replace(/:/g, "")
    .replace(/[{}]/g, "")}`;
}

function inferHttpLayer(path: string): AuditEndpointLayer {
  if (path.includes("config-status") || path.includes("bunfig") || path.includes("settings")) {
    return "config";
  }
  if (path.includes("secret")) return "secrets";
  if (
    path.includes("identity") ||
    path.includes("token") ||
    path.includes("cookies") ||
    path.includes("csrf") ||
    path.includes("jwt")
  ) {
    return "identity";
  }
  if (
    path.includes("gates") ||
    path.includes("doctor") ||
    path.includes("trace") ||
    path.includes("toolchain") ||
    path.includes("artifacts") ||
    path.includes("runs") ||
    path.includes("sessions")
  ) {
    return "doctor";
  }
  return "runtime";
}

/** Full dashboard HTTP catalog — static dispatch + artifact URLPattern routes. */
export function buildDashboardHttpEndpointCatalog(): readonly AuditEndpointMeta[] {
  const curatedByPath = new Map(AUDIT_HTTP_CURATED.map((entry) => [entry.path, entry]));

  const staticMetas: AuditEndpointMeta[] = DASHBOARD_STATIC_ROUTES.filter((route) =>
    route.path.startsWith("/api/")
  ).map((route) => {
    const curated = curatedByPath.get(route.path);
    if (curated) {
      return { ...curated, httpMethods: route.methods, curated: true };
    }
    return {
      id: httpPathToId(route.path),
      kind: "http",
      path: route.path,
      entry: "examples/dashboard/src/handlers/routes.ts",
      httpMethods: [...route.methods],
      layer: inferHttpLayer(route.path),
      dryRun: false,
      strictBlocks: false,
      description: `Dashboard static route ${route.path}`,
      curated: false,
    };
  });

  const artifactMetas: AuditEndpointMeta[] = [
    ...DASHBOARD_ARTIFACT_EXACT_PATHS,
    ...DASHBOARD_ARTIFACT_PATTERN_PATHS,
  ].map((path) => ({
    id: httpPathToId(path),
    kind: "http" as const,
    path,
    entry: "examples/dashboard/src/handlers/artifacts.ts",
    httpMethods: ["GET"] as const,
    layer: inferHttpLayer(path),
    dryRun: false,
    strictBlocks: false,
    description: `Dashboard artifact route ${path}`,
    curated: false,
  }));

  const byPath = new Map<string, AuditEndpointMeta>();
  for (const entry of [...staticMetas, ...artifactMetas]) {
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export const DASHBOARD_HTTP_ENDPOINTS: readonly AuditEndpointMeta[] =
  buildDashboardHttpEndpointCatalog();

export const ALL_AUDIT_ENDPOINTS: readonly AuditEndpointMeta[] = [
  ...AUDIT_CLI_ENDPOINTS,
  ...DASHBOARD_HTTP_ENDPOINTS,
];

export function curatedHttpEndpoints(): readonly AuditEndpointMeta[] {
  return DASHBOARD_HTTP_ENDPOINTS.filter((entry) => entry.curated);
}

export const AUDIT_ENDPOINTS_SCHEMA_VERSION = 1;

export function cliEndpointsWithDryRun(): readonly AuditEndpointMeta[] {
  return AUDIT_CLI_ENDPOINTS.filter((e) => e.dryRun && e.path.includes(":"));
}

export function endpointsByLayer(layer: AuditEndpointLayer): readonly AuditEndpointMeta[] {
  return ALL_AUDIT_ENDPOINTS.filter((e) => e.layer === layer);
}

export function endpointCatalogSummary(): {
  schemaVersion: number;
  cli: number;
  http: {
    curated: number;
    dashboard: number;
  };
  total: number;
  layers: Record<AuditEndpointLayer, number>;
} {
  const layers = {} as Record<AuditEndpointLayer, number>;
  for (const ep of ALL_AUDIT_ENDPOINTS) {
    layers[ep.layer] = (layers[ep.layer] ?? 0) + 1;
  }
  return {
    schemaVersion: AUDIT_ENDPOINTS_SCHEMA_VERSION,
    cli: AUDIT_CLI_ENDPOINTS.length,
    http: {
      curated: curatedHttpEndpoints().length,
      dashboard: DASHBOARD_HTTP_ENDPOINTS.length,
    },
    total: ALL_AUDIT_ENDPOINTS.length,
    layers,
  };
}
