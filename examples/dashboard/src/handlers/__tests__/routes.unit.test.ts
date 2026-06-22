import { describe, expect, test } from "bun:test";
import { dispatchDashboardRoute } from "../dispatch.ts";
import { DASHBOARD_STATIC_ROUTES, ROUTE_BY_PATH } from "../routes.ts";

describe("dashboard-routes", () => {
  test("ROUTE_BY_PATH has no duplicate paths", () => {
    expect(ROUTE_BY_PATH.size).toBe(DASHBOARD_STATIC_ROUTES.length);
  });

  test("route table includes static shell assets", () => {
    const paths = [...ROUTE_BY_PATH.keys()];
    expect(paths).toContain("/dashboard.css");
    expect(paths).toContain("/dashboard.js");
  });

  test("route table includes showcase and health endpoints", () => {
    const paths = [...ROUTE_BY_PATH.keys()];
    expect(paths).toContain("/api/examples/gates");
    expect(paths).toContain("/api/examples/trading");
    expect(paths).toContain("/api/health");
    expect(paths).toContain("/api/effect-benchmark/refresh");
  });

  test("POST on GET-only route returns JSON 405", async () => {
    const res = await dispatchDashboardRoute(
      new Request("http://127.0.0.1/api/gates", { method: "POST" })
    );
    expect(res?.status).toBe(405);
    const body = await res!.json();
    expect(body.ok).toBe(false);
    expect(body.method).toBe("POST");
  });

  test("GET on POST-only route returns JSON 405", async () => {
    const res = await dispatchDashboardRoute(
      new Request("http://127.0.0.1/api/effect-benchmark/refresh")
    );
    expect(res?.status).toBe(405);
  });

  test("unknown path returns null for upstream 404", async () => {
    const res = await dispatchDashboardRoute(new Request("http://127.0.0.1/api/not-real"));
    expect(res).toBeNull();
  });
});
