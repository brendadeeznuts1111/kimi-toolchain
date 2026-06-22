import { describe, expect, test } from "bun:test";
import {
  ALL_AUDIT_ENDPOINTS,
  AUDIT_CLI_ENDPOINTS,
  AUDIT_HTTP_CURATED,
  DASHBOARD_HTTP_ENDPOINTS,
  buildDashboardHttpEndpointCatalog,
  cliEndpointsWithDryRun,
  curatedHttpEndpoints,
  endpointCatalogSummary,
  endpointsByLayer,
} from "../src/lib/audit-endpoints-metadata.ts";
import { DASHBOARD_STATIC_ROUTES } from "../examples/dashboard/src/handlers/routes.ts";

describe("audit-endpoints-metadata", () => {
  test("endpointCatalogSummary counts cli and dashboard http routes", () => {
    const summary = endpointCatalogSummary();
    expect(summary.cli).toBe(AUDIT_CLI_ENDPOINTS.length);
    expect(summary.http.dashboard).toBe(DASHBOARD_HTTP_ENDPOINTS.length);
    expect(summary.http.curated).toBe(curatedHttpEndpoints().length);
    expect(summary.total).toBe(ALL_AUDIT_ENDPOINTS.length);
    expect(summary.schemaVersion).toBeGreaterThan(0);
  });

  test("buildDashboardHttpEndpointCatalog covers static /api routes", () => {
    const apiStatic = DASHBOARD_STATIC_ROUTES.filter((r) => r.path.startsWith("/api/"));
    const catalog = buildDashboardHttpEndpointCatalog();
    for (const route of apiStatic) {
      expect(catalog.some((entry) => entry.path === route.path)).toBe(true);
    }
  });

  test("cliEndpointsWithDryRun lists audit scripts with dry-run support", () => {
    const dryRun = cliEndpointsWithDryRun();
    expect(dryRun.some((e) => e.path === "audit:secrets")).toBe(true);
    expect(dryRun.some((e) => e.path === "audit:config")).toBe(true);
    expect(dryRun.every((e) => e.dryRun)).toBe(true);
  });

  test("curated http entries are a subset of dashboard catalog", () => {
    const curatedPaths = new Set(AUDIT_HTTP_CURATED.map((e) => e.path));
    for (const path of curatedPaths) {
      expect(DASHBOARD_HTTP_ENDPOINTS.some((e) => e.path === path)).toBe(true);
    }
    expect(endpointsByLayer("identity").some((e) => e.path === "/api/identity/flow")).toBe(true);
  });
});
