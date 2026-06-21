import { describe, expect, test } from "bun:test";
import { renderCardShell } from "../src/lib/dashboard-card-shells.ts";
import {
  buildDashboardRouteInventory,
  dashboardStaticCardApiPaths,
  lintDashboardHandlerExports,
  lintDashboardRouteParity,
  scanDashboardRouteHandlerRefs,
  syncDashboardRouteDocs,
  wiredDashboardRouteHandlers,
} from "../src/lib/dashboard-route-inventory.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-route-inventory", () => {
  test("buildDashboardRouteInventory matches static + artifact tables", () => {
    const inventory = buildDashboardRouteInventory();
    expect(inventory.pageHealth).toBe(3);
    expect(inventory.staticDispatch).toBe(inventory.staticRoutes.length - 3);
    expect(inventory.artifactRoutes).toBe(16);
    expect(inventory.total).toBe(inventory.staticRoutes.length + inventory.artifactRoutes);
  });

  test("lintDashboardRouteParity passes for canonical repo", () => {
    expect(lintDashboardRouteParity(REPO_ROOT)).toEqual([]);
  });

  test("syncDashboardRouteDocs check passes after markers are present", () => {
    const violations = syncDashboardRouteDocs(REPO_ROOT, { check: true });
    expect(violations).toEqual([]);
  });

  test("scanDashboardRouteHandlerRefs finds wired api handlers", () => {
    const source = Bun.file(
      `${REPO_ROOT}/examples/dashboard/src/handlers/routes.ts`
    ).text();
    return source.then((text) => {
      const refs = scanDashboardRouteHandlerRefs(text);
      expect(refs).toContain("apiGates");
      expect(refs).toContain("apiExamplesGates");
      expect(refs.length).toBeGreaterThan(80);
    });
  });

  test("wiredDashboardRouteHandlers and handler export lint pass", async () => {
    const routesSource = await Bun.file(
      `${REPO_ROOT}/examples/dashboard/src/handlers/routes.ts`
    ).text();
    const wired = wiredDashboardRouteHandlers(routesSource);
    expect(wired).toContain("apiGates");
    expect(wired).toContain("apiExamplesGates");
    expect(wired.length).toBeGreaterThan(90);
    expect(lintDashboardHandlerExports(REPO_ROOT, routesSource)).toEqual([]);
  });

  test("dashboardStaticCardApiPaths excludes meta hub routes", () => {
    const paths = dashboardStaticCardApiPaths();
    expect(paths).toContain("/api/bundle");
    expect(paths).not.toContain("/api/cards");
    expect(paths).not.toContain("/api/examples");
  });

  test("renderCardShell escapes title markup", () => {
    const html = renderCardShell("card-test", "<unsafe>");
    expect(html).toContain('id="card-test"');
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).not.toContain("<unsafe>");
  });
});