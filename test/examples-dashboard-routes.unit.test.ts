import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";

const DASHBOARD_ENTRY = join(REPO_ROOT, "examples/dashboard/src/index.ts");
const DISPATCH = join(REPO_ROOT, "examples/dashboard/src/handlers/dispatch.ts");

describe("examples-dashboard-routes", () => {
  test("index.ts delegates to artifacts preflight and dispatch router", async () => {
    const source = await Bun.file(DASHBOARD_ENTRY).text();
    expect(source).toContain("handleArtifactsRequest(req)");
    expect(source).toContain("dispatchDashboardRoute(req)");
    expect(source).toContain("logDashboardEvent");
    expect(source).toContain("isDashboardProbeRequest");
    expect(source).not.toContain('case "/api/bundle"');
  });

  test("dispatch.ts wires core card and contract routes", async () => {
    const source = await Bun.file(DISPATCH).text();
    expect(source).toContain('case "/api/health"');
    expect(source).toContain('method === "HEAD"');
    expect(source).toContain('case "/api/file-split"');
    expect(source).toContain('case "/api/effect-benchmark"');
    expect(source).toContain('case "/api/effect-benchmark/refresh"');
    expect(source).toContain('case "/api/effect-benchmark/train"');
    expect(source).toContain('case "/api/config-status"');
    expect(source).toContain('case "/api/bun-runtime"');
    expect(source).toContain("readBenchmarkHealthCheck");
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
    expect(source).toContain('case "/api/canvases"');
    expect(source).toContain('case "/api/settings"');
    expect(source).toContain('case "/api/terminal"');
    expect(source).toContain("apiTerminal()");
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
