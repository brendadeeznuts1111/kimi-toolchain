import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";

const DASHBOARD_ENTRY = join(REPO_ROOT, "examples/dashboard/src/index.ts");
const DISPATCH = join(REPO_ROOT, "examples/dashboard/src/handlers/dispatch.ts");
const ROUTES = join(REPO_ROOT, "examples/dashboard/src/handlers/routes.ts");

describe("examples-dashboard-routes", () => {
  test("index.ts delegates to artifacts preflight and dispatch router", async () => {
    const source = await Bun.file(DASHBOARD_ENTRY).text();
    expect(source).toContain("handleArtifactsRequest(req)");
    expect(source).toContain("dispatchDashboardRoute(req)");
    expect(source).toContain("appendDashboardHttpAudit");
    expect(source).toContain("isDashboardProbeRequest");
    expect(source).not.toContain('case "/api/bundle"');
  });

  test("dispatch.ts delegates to route table SSOT", async () => {
    const dispatchSource = await Bun.file(DISPATCH).text();
    const routesSource = await Bun.file(ROUTES).text();
    expect(dispatchSource).toContain("ROUTE_BY_PATH");
    expect(dispatchSource).toContain("methodNotAllowedJson");
    expect(dispatchSource).not.toContain('case "/api/bundle"');
    expect(routesSource).toContain('"/api/health"');
    expect(routesSource).toContain("apiHealth");
    expect(routesSource).toContain('"/api/file-split"');
    expect(routesSource).toContain('"/api/effect-benchmark"');
    expect(routesSource).toContain('"/api/effect-benchmark/refresh"');
    expect(routesSource).toContain('"/api/effect-benchmark/train"');
    expect(routesSource).toContain('"/api/config-status"');
    expect(routesSource).toContain('"/api/bun-runtime"');
    expect(routesSource).toContain('"/api/bun-pm"');
    expect(routesSource).toContain("readBenchmarkHealthCheck");
    const benchmarkHandler = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/effect-benchmark.ts")
    ).text();
    expect(benchmarkHandler).toContain("checkBenchmarkPostCooldown");
    expect(benchmarkHandler).toContain("runEffectBenchmarkCardLoop");
    const configStatusHandler = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/config-status.ts")
    ).text();
    expect(configStatusHandler).toContain("auditConfigLayersStatus");
    const bunRuntimeHandler = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/bun-runtime.ts")
    ).text();
    expect(bunRuntimeHandler).toContain("auditRuntimeCapabilitiesHealth");
    const bunPmHandler = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/bun-pm.ts")
    ).text();
    expect(bunPmHandler).toContain("auditBunPmCliHealth");
    expect(bunPmHandler).toContain("buildInstallPolicyReport");
    expect(routesSource).toContain('"/api/examples/gates"');
    expect(routesSource).toContain("apiExamplesGates");
    expect(routesSource).toContain('"/api/canvases"');
    expect(routesSource).toContain('"/api/settings"');
    expect(routesSource).toContain('"/api/terminal"');
    expect(routesSource).toContain("apiTerminal");
    expect(routesSource).toContain('"/api/artifact-graph-convergence/schema"');
    expect(routesSource).toContain("apiArtifactGraphConvergenceSchema");
    expect(routesSource).toContain('"/dashboard.css"');
    expect(routesSource).toContain('"/dashboard.js"');
    expect(routesSource).toContain("dashboardAssetResponse");
  });

  test("artifacts handler wires URLPattern session routes from dashboard-route-patterns", async () => {
    const source = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/artifacts.ts")
    ).text();
    expect(source).toContain("DASHBOARD_SESSION_RUNS");
    expect(source).toContain("DASHBOARD_SESSION_ARTIFACTS");
    expect(source).toContain('path === "/api/sessions"');
    expect(source).toContain("fetchDashboardRunsList");
    expect(source).toContain("fetchDashboardRunManifest");
    expect(source).toContain("artifactFilterFromSessionRoute");
    expect(source).toContain("count: artifacts.length");
  });

  test("dead handlers/server.ts fragment is not present", async () => {
    const deadServer = join(REPO_ROOT, "examples/dashboard/src/handlers/server.ts");
    expect(await Bun.file(deadServer).exists()).toBe(false);
  });
});
