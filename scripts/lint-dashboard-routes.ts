#!/usr/bin/env bun
/**
 * Dashboard route inventory lint — doc sync, card parity, route table coverage.
 *
 * Usage:
 *   bun run scripts/lint-dashboard-routes.ts           # lint only
 *   bun run scripts/lint-dashboard-routes.ts --check   # lint + verify doc markers
 *   bun run scripts/lint-dashboard-routes.ts --write     # refresh README + dashboard-urls markers
 */

import { join } from "path";
import { syncDashboardCardShells } from "../src/lib/dashboard-card-shells.ts";
import { lintDashboardStaticAssets } from "../src/lib/dashboard-static-assets-lint.ts";
import {
  buildDashboardRouteInventory,
  lintDashboardHandlerExports,
  lintDashboardRouteParity,
  scanDashboardRouteHandlerRefs,
  syncDashboardRouteDocs,
  wiredDashboardRouteHandlers,
} from "../src/lib/dashboard-route-inventory.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const args = new Set(Bun.argv.slice(2));
const check = args.has("--check") || !args.has("--write");
const write = args.has("--write");

async function main(): Promise<void> {
  const inventory = buildDashboardRouteInventory();
  const parityIssues = lintDashboardRouteParity(REPO_ROOT);
  const docIssues = syncDashboardRouteDocs(REPO_ROOT, { check });
  const shellIssues = syncDashboardCardShells(REPO_ROOT, { check: true });
  const assetIssues = lintDashboardStaticAssets(REPO_ROOT);

  const routesSource = await Bun.file(
    join(REPO_ROOT, "examples/dashboard/src/handlers/routes.ts")
  ).text();
  const handlerRefs = scanDashboardRouteHandlerRefs(routesSource);
  const wiredHandlers = wiredDashboardRouteHandlers(routesSource);
  const handlerExportIssues = lintDashboardHandlerExports(REPO_ROOT, routesSource);

  const violations = [
    ...parityIssues.map((v) => v.message),
    ...docIssues,
    ...shellIssues,
    ...assetIssues,
    ...handlerExportIssues,
  ];

  if (write) {
    syncDashboardRouteDocs(REPO_ROOT, { check: false });
    syncDashboardCardShells(REPO_ROOT, { check: false });
    console.log(`dashboard-routes docs + shells refreshed (${inventory.total} routes)`);
  }

  if (violations.length > 0) {
    console.error("dashboard-routes lint failed:\n");
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log(
    `dashboard-routes OK (${inventory.total} routes: ${inventory.pageHealth} page/health, ${inventory.staticDispatch} static, ${inventory.artifactRoutes} artifact; ${wiredHandlers.length} wired handlers, ${handlerRefs.length} import refs)`
  );
}

main().catch((err) => {
  console.error("lint-dashboard-routes failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
