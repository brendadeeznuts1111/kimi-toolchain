// ── Transpiler Scan ────────────────────────────────────────────────
import { join } from "path";
import {
  buildDashboardRouteInventory,
  lintDashboardHandlerExports,
  scanDashboardRouteHandlerRefs,
  wiredDashboardRouteHandlers,
} from "../../../../src/lib/dashboard-route-inventory.ts";
import { jsonResponse, resolveRoot } from "./shared.ts";

interface EffectMethod {
  file: string;
  exports: string[];
  importCount: number;
}

export async function apiTranspilerScan(): Promise<Response> {
  const projectRoot = resolveRoot();
  const routesPath = join(projectRoot, "examples/dashboard/src/handlers/routes.ts");
  const routesSource = await Bun.file(routesPath).text();
  const wiredHandlers = wiredDashboardRouteHandlers(routesSource);
  const handlerExportIssues = lintDashboardHandlerExports(projectRoot, routesSource);
  const importRefs = scanDashboardRouteHandlerRefs(routesSource);
  const inventory = buildDashboardRouteInventory();

  const files = [
    "examples/dashboard/src/handlers/routes.ts",
    "examples/dashboard/src/handlers/dispatch.ts",
    "examples/dashboard/src/index.ts",
  ];
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const results: EffectMethod[] = [];

  for (const rel of files) {
    const path = join(projectRoot, rel);
    try {
      const source = await Bun.file(path).text();
      const scan = transpiler.scan(source);
      results.push({ file: rel, exports: scan.exports, importCount: scan.imports.length });
    } catch {
      results.push({ file: rel, exports: [], importCount: 0 });
    }
  }

  const totalExports = results.reduce((sum, row) => sum + row.exports.length, 0);

  return jsonResponse({
    results,
    totalExports,
    routeInventory: {
      total: inventory.total,
      staticDispatch: inventory.staticDispatch,
      artifactRoutes: inventory.artifactRoutes,
      wiredHandlers: wiredHandlers.length,
      importRefs: importRefs.length,
      handlerExportOk: handlerExportIssues.length === 0,
    },
    wiredHandlers,
    handlerExportIssues,
    pipeline: [
      "Bun.Transpiler({ loader: 'ts' })",
      ".scan(source) → { exports: string[], imports: [...] }",
      "routes.ts handler refs cross-checked via scanDashboardRouteHandlerRefs()",
      "lint: bun run scripts/lint-dashboard-routes.ts",
    ],
    note: "Transpiler scan + route inventory lint keep dispatch table and handler exports aligned.",
  });
}
