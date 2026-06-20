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
    expect(source).toContain('case "/api/canvases"');
    expect(source).toContain('case "/api/settings"');
  });

  test("artifacts handler wires URLPattern session routes from dashboard-route-patterns", async () => {
    const source = await Bun.file(
      join(REPO_ROOT, "examples/dashboard/src/handlers/artifacts.ts")
    ).text();
    expect(source).toContain("DASHBOARD_SESSION_RUNS");
    expect(source).toContain("DASHBOARD_SESSION_ARTIFACTS");
    expect(source).toContain('path === "/api/sessions"');
    expect(source).toContain("artifactFilterFromSessionRoute");
    expect(source).toContain("count: artifacts.length");
  });

  test("dead handlers/server.ts fragment is not present", async () => {
    const deadServer = join(REPO_ROOT, "examples/dashboard/src/handlers/server.ts");
    expect(await Bun.file(deadServer).exists()).toBe(false);
  });
});
