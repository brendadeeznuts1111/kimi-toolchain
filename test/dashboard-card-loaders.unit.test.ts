import { describe, expect, test } from "bun:test";
import { DASHBOARD_LOADER_LANES } from "../examples/dashboard/src/lib/dashboard-assets.ts";
import {
  missingCardLoaders,
  renderCardLoaderStub,
  syncDashboardCardLoaders,
} from "../src/lib/dashboard-card-loaders.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-card-loaders", () => {
  test("missingCardLoaders is empty for canonical repo", () => {
    expect(missingCardLoaders(REPO_ROOT)).toEqual([]);
  });

  test("syncDashboardCardLoaders check passes with AUTO markers", () => {
    expect(syncDashboardCardLoaders(REPO_ROOT, { check: true })).toEqual([]);
  });

  test("renderCardLoaderStub quotes api route safely", () => {
    const stub = renderCardLoaderStub("card-demo", "/api/demo");
    expect(stub).toContain('card("card-demo"');
    expect(stub).toContain('fetchJson("/api/demo")');
  });

  test("dashboard loader lane files exist and use ES module imports", async () => {
    for (const lane of DASHBOARD_LOADER_LANES) {
      const path = `${REPO_ROOT}/examples/dashboard/src/dashboard-loaders/${lane}.js`;
      const text = await Bun.file(path).text();
      expect(text.length).toBeGreaterThan(100);
      expect(text).toContain('from "/dashboard-core.js"');
    }
  });
});
