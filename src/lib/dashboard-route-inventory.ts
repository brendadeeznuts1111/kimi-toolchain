/**
 * Examples dashboard route inventory — SSOT for endpoint counts and lint parity.
 */

import { join } from "path";
import {
  DASHBOARD_STATIC_ROUTES,
  type DashboardStaticRoute,
} from "../../examples/dashboard/src/handlers/routes.ts";
import { dashboardHtmlPath, loadDashboardCards } from "./dashboard-card-registry.ts";
import { readText } from "./bun-io.ts";

/** Exact artifact/run paths in handlers/artifacts.ts (pre-URLPattern switch). */
export const DASHBOARD_ARTIFACT_EXACT_PATHS = [
  "/api/artifacts",
  "/api/gates/graph",
  "/api/runs",
  "/api/sessions",
  "/api/artifacts/list",
  "/api/artifacts/filter-options",
  "/api/artifacts/metadata",
  "/api/artifact-graph",
  "/api/artifacts/context",
] as const;

/** Parameterized artifact/run paths (URLPattern SSOT in dashboard-route-patterns.ts). */
export const DASHBOARD_ARTIFACT_PATTERN_PATHS = [
  "/api/artifacts/feed.xml",
  "/api/artifacts/index/stats",
  "/api/artifacts/:gate/lineage",
  "/api/artifacts/:gate/diff",
  "/api/runs/:runId",
  "/api/sessions/:scope/runs",
  "/api/sessions/:scope/artifacts",
] as const;

/** Static routes without a dashboard.html probe card (meta, hub, or POST-only). */
export const DASHBOARD_META_ROUTES = new Set<string>([
  "/",
  "/health",
  "/api/health",
  "/api/settings",
  "/api/examples",
  "/api/examples/trading",
  "/api/examples/gates",
  "/api/canvases",
  "/api/cards",
  "/api/canvas-filter",
  "/api/effect-benchmark/refresh",
  "/api/effect-benchmark/train",
  "/api/artifact-graph-convergence/schema",
]);

export interface DashboardRouteInventory {
  total: number;
  pageHealth: number;
  staticDispatch: number;
  artifactRoutes: number;
  staticRoutes: readonly DashboardStaticRoute[];
}

export function buildDashboardRouteInventory(): DashboardRouteInventory {
  const staticRoutes = DASHBOARD_STATIC_ROUTES;
  const pageHealth = staticRoutes.filter((r) =>
    ["/", "/health", "/api/health"].includes(r.path)
  ).length;
  const artifactRoutes =
    DASHBOARD_ARTIFACT_EXACT_PATHS.length + DASHBOARD_ARTIFACT_PATTERN_PATHS.length;

  return {
    total: staticRoutes.length + artifactRoutes,
    pageHealth,
    staticDispatch: staticRoutes.length - pageHealth,
    artifactRoutes,
    staticRoutes,
  };
}

export interface DashboardRouteLintIssue {
  kind: "doc-drift" | "card-panel-missing" | "card-route-missing";
  message: string;
}

function panelIdsFromHtml(html: string): Set<string> {
  return new Set([...html.matchAll(/id="(card-[^"]+)"/g)].map((m) => m[1]!));
}

/** Registry cards must render a panel; probed routes must exist in static or artifact tables. */
export function lintDashboardRouteParity(repoRoot: string): DashboardRouteLintIssue[] {
  const issues: DashboardRouteLintIssue[] = [];
  const inventory = buildDashboardRouteInventory();
  const cards = loadDashboardCards(repoRoot);
  const html = readText(dashboardHtmlPath(repoRoot));
  const panels = panelIdsFromHtml(html);

  const staticPaths = new Set(inventory.staticRoutes.map((r) => r.path));
  const artifactPaths = new Set<string>([
    ...DASHBOARD_ARTIFACT_EXACT_PATHS,
    ...DASHBOARD_ARTIFACT_PATTERN_PATHS,
  ]);
  for (const card of cards) {
    if (!panels.has(card.id)) {
      issues.push({
        kind: "card-panel-missing",
        message: `${card.id} (${card.apiRoute ?? "no route"}) missing id="${card.id}" panel in dashboard.html`,
      });
    }
    if (card.apiRoute && !staticPaths.has(card.apiRoute) && !artifactPaths.has(card.apiRoute)) {
      issues.push({
        kind: "card-route-missing",
        message: `${card.id} apiRoute ${card.apiRoute} not in routes.ts or artifact inventory`,
      });
    }
  }

  return issues;
}

const README_INVENTORY_BLOCK =
  /<!-- dashboard-route-inventory:AUTO -->[\s\S]*?<!-- \/dashboard-route-inventory:AUTO -->/;

export function formatDashboardRouteInventoryBlock(inventory: DashboardRouteInventory): string {
  return `<!-- dashboard-route-inventory:AUTO -->
**Endpoint count:** **${inventory.total}** routes on the examples dashboard (\`examples/dashboard/src/index.ts\` + \`handlers/artifacts.ts\`).

- **${inventory.pageHealth}** page/health routes (\`/\`, \`/health\`, \`/api/health\`)
- **${inventory.staticDispatch}** static dispatch API paths (\`handlers/routes.ts\`, includes \`/dashboard.css\` + \`/dashboard-core.js\` + \`/dashboard.js\`)
- **${inventory.artifactRoutes}** artifact/run routes (\`handlers/artifacts.ts\` + URLPattern; not duplicated in route table)
<!-- /dashboard-route-inventory:AUTO -->`;
}

export function syncDashboardRouteDocs(
  repoRoot: string,
  options: { check?: boolean } = {}
): string[] {
  const inventory = buildDashboardRouteInventory();
  const block = formatDashboardRouteInventoryBlock(inventory);
  const violations: string[] = [];

  const readmePath = join(repoRoot, "examples/dashboard/README.md");
  const urlsPath = join(repoRoot, "examples/dashboard-urls.md");
  const readme = readText(readmePath);
  const urls = readText(urlsPath);

  if (!README_INVENTORY_BLOCK.test(readme)) {
    violations.push("examples/dashboard/README.md missing dashboard-route-inventory markers");
  } else if (options.check) {
    const match = readme.match(README_INVENTORY_BLOCK)?.[0];
    if (match !== block)
      violations.push("examples/dashboard/README.md route inventory block is stale");
  } else {
    Bun.write(readmePath, readme.replace(README_INVENTORY_BLOCK, block));
  }

  const urlsLine = `Examples dashboard (\`handlers/routes.ts\` + \`handlers/artifacts.ts\`) — **${inventory.total}** routes total (see [dashboard/README.md](dashboard/README.md)).`;
  const urlsPattern =
    /Examples dashboard \(`handlers\/routes\.ts` \+ `handlers\/artifacts\.ts`\) — \*\*\d+\*\* routes total/;
  if (!urlsPattern.test(urls)) {
    violations.push("examples/dashboard-urls.md missing route total summary line");
  } else if (options.check) {
    if (!urls.includes(urlsLine))
      violations.push("examples/dashboard-urls.md route total line is stale");
  } else {
    const nextUrls = urls.replace(
      /Examples dashboard \(`handlers\/routes\.ts` \+ `handlers\/artifacts\.ts`\) — \*\*\d+\*\* routes total[^\n]*/,
      urlsLine
    );
    Bun.write(urlsPath, nextUrls);
  }

  const switchLine =
    "Static card routes in `examples/dashboard/src/handlers/routes.ts` use a route table; artifact, run, and session trees use URLPattern matchers shared with Herdr and serve-probe.";
  if (urls.includes("switch (url.pathname)") && !options.check) {
    Bun.write(
      urlsPath,
      urls.replace(
        /Static card routes in `examples\/dashboard\/src\/index\.ts` use a `switch \(url\.pathname\)`;[^\n]+/,
        switchLine
      )
    );
  }

  const staticBlock = formatDashboardStaticRoutesBlock(inventory);
  const staticBlockRe =
    /<!-- dashboard-static-routes:AUTO -->[\s\S]*?<!-- \/dashboard-static-routes:AUTO -->/;
  if (!staticBlockRe.test(urls)) {
    violations.push("examples/dashboard-urls.md missing dashboard-static-routes markers");
  } else if (options.check) {
    const match = urls.match(staticBlockRe)?.[0];
    if (match !== staticBlock) {
      violations.push("examples/dashboard-urls.md static routes table is stale");
    }
  } else {
    const nextUrls = urls.replace(staticBlockRe, staticBlock);
    Bun.write(urlsPath, nextUrls);
  }

  const decomposedLine = `**${inventory.total}** examples-dashboard routes. Representative rows (full table in [dashboard/README.md](dashboard/README.md)):`;
  const decomposedPattern = /\*\*\d+\*\* examples-dashboard routes\./;
  if (decomposedPattern.test(urls)) {
    if (options.check) {
      if (!urls.includes(decomposedLine)) {
        violations.push("examples/dashboard-urls.md decomposed route count is stale");
      }
    } else {
      const refreshed = readText(urlsPath).replace(
        decomposedPattern,
        `**${inventory.total}** examples-dashboard routes.`
      );
      Bun.write(urlsPath, refreshed);
    }
  }

  return violations;
}

const STATIC_ROUTES_COLS = 4;

/** GET card API paths from the static route table (excludes meta/hub routes). */
export function dashboardStaticCardApiPaths(
  inventory: DashboardRouteInventory = buildDashboardRouteInventory()
): string[] {
  return inventory.staticRoutes
    .filter(
      (route) =>
        route.path.startsWith("/api/") &&
        route.methods.includes("GET") &&
        !DASHBOARD_META_ROUTES.has(route.path)
    )
    .map((route) => route.path)
    .sort();
}

export function formatDashboardStaticRoutesBlock(
  inventory: DashboardRouteInventory = buildDashboardRouteInventory()
): string {
  const paths = dashboardStaticCardApiPaths(inventory);
  const header = `| ${Array(STATIC_ROUTES_COLS).fill("Path").join(" | ")} |`;
  const sep = `| ${Array(STATIC_ROUTES_COLS).fill("---").join(" | ")} |`;
  const rows: string[] = [];
  for (let i = 0; i < paths.length; i += STATIC_ROUTES_COLS) {
    const cells = paths.slice(i, i + STATIC_ROUTES_COLS).map((path) => `\`${path}\``);
    while (cells.length < STATIC_ROUTES_COLS) cells.push("");
    rows.push(`| ${cells.join(" | ")} |`);
  }
  return `<!-- dashboard-static-routes:AUTO -->
### All static card API paths (\`handlers/routes.ts\`)

\`GET\` unless noted. Grouped by prefix:

${header}
${sep}
${rows.join("\n")}
<!-- /dashboard-static-routes:AUTO -->`;
}

/** Handlers wired in DASHBOARD_STATIC_ROUTES (excludes inline arrow handlers). */
export function wiredDashboardRouteHandlers(routesSource: string): string[] {
  const refs = new Set<string>();
  for (const match of routesSource.matchAll(/route0?\(\s*"[^"]+",\s*(\w+)/g)) {
    refs.add(match[1]!);
  }
  for (const match of routesSource.matchAll(/route\(\s*"[^"]+",\s*(\w+)/g)) {
    refs.add(match[1]!);
  }
  return [...refs].sort();
}

/** Map handler symbol → relative handler module from routes.ts import lines. */
export function parseRoutesHandlerImports(routesSource: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["'](\.\/[^"']+)["']/g;
  for (const match of routesSource.matchAll(importRe)) {
    const file = match[2]!;
    for (const chunk of match[1]!.split(",")) {
      const symbol = chunk
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (symbol) imports.set(symbol, file);
    }
  }
  return imports;
}

function localRouteHandlers(routesSource: string): Set<string> {
  const locals = new Set<string>();
  for (const match of routesSource.matchAll(/(?:async\s+)?function\s+(api[A-Z]\w*)/g)) {
    locals.add(match[1]!);
  }
  return locals;
}

/** Verify every wired handler is imported (or local) and exported from its module. */
export function lintDashboardHandlerExports(
  repoRoot: string,
  routesSource: string,
  options: { exportCache?: Map<string, Set<string>> } = {}
): string[] {
  const violations: string[] = [];
  const wired = wiredDashboardRouteHandlers(routesSource);
  const imports = parseRoutesHandlerImports(routesSource);
  const locals = localRouteHandlers(routesSource);
  const handlersDir = join(repoRoot, "examples/dashboard/src/handlers");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const exportCache = options.exportCache ?? new Map<string, Set<string>>();

  for (const handler of wired) {
    if (locals.has(handler)) continue;
    const relFile = imports.get(handler);
    if (!relFile) {
      violations.push(`routes.ts wires ${handler} but no import found`);
      continue;
    }
    const filePath = join(handlersDir, relFile.replace(/^\.\//, ""));
    if (!exportCache.has(filePath)) {
      const source = readText(filePath);
      const scan = transpiler.scan(source);
      exportCache.set(filePath, new Set(scan.exports));
    }
    if (!exportCache.get(filePath)!.has(handler)) {
      violations.push(`${handler} not exported from handlers/${relFile.replace(/^\.\//, "")}`);
    }
  }

  return violations;
}

/** Scan routes.ts for wired handler symbols (transpiler-free static parse). */
export function scanDashboardRouteHandlerRefs(routesSource: string): string[] {
  const refs = new Set<string>();
  for (const match of routesSource.matchAll(/\b(api[A-Z][A-Za-z0-9]+)\b/g)) {
    refs.add(match[1]!);
  }
  refs.delete("apiHealth");
  return [...refs].sort();
}
