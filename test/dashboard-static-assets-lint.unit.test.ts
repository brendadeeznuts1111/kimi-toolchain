import { describe, expect, test } from "bun:test";
import { DASHBOARD_STATIC_ASSETS } from "../examples/dashboard/src/lib/dashboard-assets.ts";
import { dispatchDashboardRoute } from "../examples/dashboard/src/handlers/dispatch.ts";
import { lintDashboardStaticAssets } from "../src/lib/dashboard-static-assets-lint.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-static-assets-lint", () => {
  test("lintDashboardStaticAssets passes for canonical shell", () => {
    expect(lintDashboardStaticAssets(REPO_ROOT)).toEqual([]);
  });

  test("dashboard.html references every static asset", async () => {
    const html = await Bun.file(`${REPO_ROOT}/examples/dashboard/src/dashboard.html`).text();
    for (const asset of DASHBOARD_STATIC_ASSETS) {
      if (asset === "dashboard-loader-lanes.js") continue;
      expect(html).toContain(`/${asset}`);
    }
    expect(html).toContain('type="module"');
    expect(html).toContain('src="/dashboard-core.js"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
  });

  test("dispatch serves shell assets and lazy loader lanes", async () => {
    for (const path of [
      "/dashboard.css",
      "/dashboard-core.js",
      "/dashboard-loader-lanes.js",
      "/dashboard.js",
      "/dashboard-loaders/perf.js",
      "/dashboard-loaders/governance.js",
      "/dashboard-loaders/toolchain.js",
      "/dashboard-loaders/runtime.js",
      "/dashboard-loaders/identity.js",
    ] as const) {
      const res = await dispatchDashboardRoute(new Request(`http://127.0.0.1${path}`));
      expect(res?.status).toBe(200);
      const type = res?.headers.get("content-type") ?? "";
      if (path.endsWith(".css")) expect(type).toContain("text/css");
      if (path.endsWith(".js")) expect(type).toContain("javascript");
      const body = await res!.text();
      expect(body.length).toBeGreaterThan(100);
    }
  });
});
