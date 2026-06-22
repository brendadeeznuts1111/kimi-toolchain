/**
 * Lint dashboard-loader-lanes.js SSOT parity with dashboard-assets.ts.
 */

import { join } from "path";
import { DASHBOARD_LOADER_LANES } from "../../examples/dashboard/src/lib/dashboard-assets.ts";
import { pathExists, readText } from "./bun-io.ts";

export function lintDashboardLoaderLanes(repoRoot: string): string[] {
  const violations: string[] = [];
  const lanesPath = join(repoRoot, "examples/dashboard/src/dashboard-loader-lanes.js");
  if (!pathExists(lanesPath)) {
    violations.push("missing examples/dashboard/src/dashboard-loader-lanes.js");
    return violations;
  }

  const source = readText(lanesPath);
  const laneKeys = Object.keys(parseLaneExports(source)).sort();
  const expected = [...DASHBOARD_LOADER_LANES].sort();
  if (laneKeys.join(",") !== expected.join(",")) {
    violations.push(
      `dashboard-loader-lanes.js keys [${laneKeys.join(", ")}] !== dashboard-assets DASHBOARD_LOADER_LANES [${expected.join(", ")}]`
    );
  }

  for (const lane of DASHBOARD_LOADER_LANES) {
    const loaderPath = join(repoRoot, "examples/dashboard/src/dashboard-loaders", `${lane}.js`);
    if (!pathExists(loaderPath)) {
      violations.push(`missing dashboard-loaders/${lane}.js`);
    }
  }

  return violations;
}

function parseLaneExports(source: string): Record<string, string[]> {
  const block = source.match(/export const DASHBOARD_LOADER_LANES\s*=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!block) return {};
  const lanes: Record<string, string[]> = {};
  for (const match of block.matchAll(/^\s*([a-z]+):\s*\[([\s\S]*?)\]/gm)) {
    const ids = [...match[2]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    lanes[match[1]!] = ids;
  }
  return lanes;
}
