import { describe, expect, test } from "bun:test";
import { lintDashboardLoaderLanes } from "../src/lib/dashboard-loader-lanes-lint.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-loader-lanes-lint", () => {
  test("lintDashboardLoaderLanes passes for canonical repo", () => {
    expect(lintDashboardLoaderLanes(REPO_ROOT)).toEqual([]);
  });
});
