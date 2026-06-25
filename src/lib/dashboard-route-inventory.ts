/**
 * Examples dashboard route inventory — SSOT for endpoint counts and lint parity.
 */

import { join } from "path";
import {
  DASHBOARD_STATIC_ROUTES,
  type DashboardStaticRoute,
} from "../../examples/dashboard/src/handlers/routes.ts";
import { DASHBOARD_COOKIE_ROUTE_PATHS } from "./serve-cookies.ts";
import { DASHBOARD_WS_PATH } from "./serve-websocket.ts";
import { dashboardHtmlPath, loadDashboardCards } from "./dashboard-card-registry.ts";
export interface DashboardServeRoute {
  path: string;
  methods: readonly ("GET" | "POST" | "HEAD")[];
  wiredIn: "index.ts routes" | "index.ts fetch";
  note?: string;
}

export const DASHBOARD_SERVE_ROUTES: readonly DashboardServeRoute[] = [
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.login,
    methods: ["GET", "POST"],
    wiredIn: "index.ts routes",
    note: "req.cookies.set — auto Set-Cookie",
  },
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.profile,
    methods: ["GET"],
    wiredIn: "index.ts routes",
    note: "req.cookies.get",
  },
  {
    path: DASHBOARD_COOKIE_ROUTE_PATHS.logout,
    methods: ["GET", "POST"],
    wiredIn: "index.ts routes",
    note: "req.cookies.delete",
  },
  {
    path: DASHBOARD_WS_PATH,
    methods: ["GET"],
    wiredIn: "index.ts fetch",
    note: "WebSocket upgrade or JSON subscriber probe",
  },
] as const;

export const DASHBOARD_SERVE_ROUTE_PATHS = new Set(
  DASHBOARD_SERVE_ROUTES.map((route) => route.path)
);

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
  serveRoutes: number;
  staticRoutes: readonly DashboardStaticRoute[];
  indexServeRoutes: readonly (typeof DASHBOARD_SERVE_ROUTES)[number][];
}

export function buildDashboardRouteInventory(): DashboardRouteInventory {
  const staticRoutes = DASHBOARD_STATIC_ROUTES;
  const pageHealth = staticRoutes.filter((r) =>
    ["/", "/health", "/api/health"].includes(r.path)
  ).length;
  const artifactRoutes =
    DASHBOARD_ARTIFACT_EXACT_PATHS.length + DASHBOARD_ARTIFACT_PATTERN_PATHS.length;

  const serveRoutes = DASHBOARD_SERVE_ROUTES.length;

  return {
    total: staticRoutes.length + artifactRoutes + serveRoutes,
    pageHealth,
    staticDispatch: staticRoutes.length - pageHealth,
    artifactRoutes,
    serveRoutes,
    staticRoutes,
    indexServeRoutes: DASHBOARD_SERVE_ROUTES,
  };
}

export interface DashboardRouteLintIssue {
  kind: "doc-drift" | "card-panel-missing" | "card-route-missing";
  message: string;
}

/** Registry cards must render a panel; probed routes must exist in static or artifact tables. */
export async function lintDashboardRouteParity(
  repoRoot: string
): Promise<DashboardRouteLintIssue[]> {
  const issues: DashboardRouteLintIssue[] = [];
  const inventory = buildDashboardRouteInventory();
  const cards = loadDashboardCards(repoRoot);
  const html = await Bun.file(dashboardHtmlPath(repoRoot)).text();
  const panels = new Set([...html.matchAll(/id="(card-[^"]+)"/g)].map((m) => m[1]!));

  const staticPaths = new Set(inventory.staticRoutes.map((r) => r.path));
  const servePaths = new Set(inventory.indexServeRoutes.map((r) => r.path));
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
    if (
      card.apiRoute &&
      !staticPaths.has(card.apiRoute) &&
      !servePaths.has(card.apiRoute) &&
      !artifactPaths.has(card.apiRoute)
    ) {
      issues.push({
        kind: "card-route-missing",
        message: `${card.id} apiRoute ${card.apiRoute} not in routes.ts, index.ts serve routes, or artifact inventory`,
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
- **${inventory.staticDispatch}** static dispatch API paths (\`handlers/routes.ts\`, shell assets + \`/dashboard-loaders/*.js\` lazy lanes)
- **${inventory.serveRoutes}** index.serve routes (\`index.ts\` \`routes\` cookie mutations + \`/api/ws\` fetch probe)
- **${inventory.artifactRoutes}** artifact/run routes (\`handlers/artifacts.ts\` + URLPattern; not duplicated in route table)
<!-- /dashboard-route-inventory:AUTO -->`;
}

export async function syncDashboardRouteDocs(
  repoRoot: string,
  options: { check?: boolean } = {}
): Promise<string[]> {
  const inventory = buildDashboardRouteInventory();
  const block = formatDashboardRouteInventoryBlock(inventory);
  const violations: string[] = [];

  const readmePath = join(repoRoot, "examples/dashboard/README.md");
  const urlsPath = join(repoRoot, "examples/dashboard-urls.md");
  const readme = await Bun.file(readmePath).text();
  let urlsDoc = await Bun.file(urlsPath).text();

  if (!README_INVENTORY_BLOCK.test(readme)) {
    violations.push("examples/dashboard/README.md missing dashboard-route-inventory markers");
  } else if (options.check) {
    const match = readme.match(README_INVENTORY_BLOCK)?.[0];
    if (match !== block)
      violations.push("examples/dashboard/README.md route inventory block is stale");
  } else {
    await Bun.write(readmePath, readme.replace(README_INVENTORY_BLOCK, block));
  }

  const urlsLine = `Examples dashboard (\`handlers/routes.ts\` + \`handlers/artifacts.ts\`) — **${inventory.total}** routes total (see [dashboard/README.md](dashboard/README.md)).`;
  const urlsPattern =
    /Examples dashboard \(`handlers\/routes\.ts` \+ `handlers\/artifacts\.ts`\) — \*\*\d+\*\* routes total/;
  if (!urlsPattern.test(urlsDoc)) {
    violations.push("examples/dashboard-urls.md missing route total summary line");
  } else if (options.check) {
    if (!urlsDoc.includes(urlsLine))
      violations.push("examples/dashboard-urls.md route total line is stale");
  } else {
    urlsDoc = urlsDoc.replace(
      /Examples dashboard \(`handlers\/routes\.ts` \+ `handlers\/artifacts\.ts`\) — \*\*\d+\*\* routes total[^\n]*/,
      urlsLine
    );
  }

  const switchLine =
    "Static card routes in `examples/dashboard/src/handlers/routes.ts` use a route table; artifact, run, and session trees use URLPattern matchers shared with Herdr and serve-probe.";
  if (urlsDoc.includes("switch (url.pathname)") && !options.check) {
    urlsDoc = urlsDoc.replace(
      /Static card routes in `examples\/dashboard\/src\/index\.ts` use a `switch \(url\.pathname\)`;[^\n]+/,
      switchLine
    );
  }

  const staticBlock = formatDashboardStaticRoutesBlock(inventory);
  const staticBlockRe =
    /<!-- dashboard-static-routes:AUTO -->[\s\S]*?<!-- \/dashboard-static-routes:AUTO -->/;
  if (!staticBlockRe.test(urlsDoc)) {
    violations.push("examples/dashboard-urls.md missing dashboard-static-routes markers");
  } else if (options.check) {
    const match = urlsDoc.match(staticBlockRe)?.[0];
    if (match !== staticBlock) {
      violations.push("examples/dashboard-urls.md static routes table is stale");
    }
  } else {
    urlsDoc = urlsDoc.replace(staticBlockRe, staticBlock);
  }

  const serveBlock = formatDashboardServeRoutesBlock(inventory);
  const serveBlockRe =
    /<!-- dashboard-serve-routes:AUTO -->[\s\S]*?<!-- \/dashboard-serve-routes:AUTO -->/;
  if (!serveBlockRe.test(urlsDoc)) {
    violations.push("examples/dashboard-urls.md missing dashboard-serve-routes markers");
  } else if (options.check) {
    const match = urlsDoc.match(serveBlockRe)?.[0];
    if (match !== serveBlock) {
      violations.push("examples/dashboard-urls.md serve routes table is stale");
    }
  } else {
    urlsDoc = urlsDoc.replace(serveBlockRe, serveBlock);
  }

  const decomposedLine = `**${inventory.total}** examples-dashboard routes. Representative rows (full table in [dashboard/README.md](dashboard/README.md)):`;
  const decomposedPattern = /\*\*\d+\*\* examples-dashboard routes\./;
  if (decomposedPattern.test(urlsDoc)) {
    if (options.check) {
      if (!urlsDoc.includes(decomposedLine)) {
        violations.push("examples/dashboard-urls.md decomposed route count is stale");
      }
    } else {
      urlsDoc = urlsDoc.replace(
        decomposedPattern,
        `**${inventory.total}** examples-dashboard routes.`
      );
    }
  }

  if (!options.check && violations.length === 0) {
    await Bun.write(urlsPath, urlsDoc);
  }

  return violations;
}

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
  const cols = 4;
  const header = `| ${Array(cols).fill("Path").join(" | ")} |`;
  const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
  const rows: string[] = [];
  for (let i = 0; i < paths.length; i += cols) {
    const cells = paths.slice(i, i + cols).map((path) => `\`${path}\``);
    while (cells.length < cols) cells.push("");
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

export function formatDashboardServeRoutesBlock(
  inventory: DashboardRouteInventory = buildDashboardRouteInventory()
): string {
  const rows = inventory.indexServeRoutes.map((route) => {
    const methods = route.methods.join("|");
    const note = route.note ?? "";
    return `| \`${route.path}\` | ${methods} | \`${route.wiredIn}\` | ${note} |`;
  });
  return `<!-- dashboard-serve-routes:AUTO -->

### Index.serve routes (\`examples/dashboard/src/index.ts\`)

Cookie mutations require \`Bun.serve({ routes })\`; \`/api/ws\` is handled in \`fetch\`.

| Path | Methods | Wired in | Note |
| --- | --- | --- | --- |
${rows.join("\n")}
<!-- /dashboard-serve-routes:AUTO -->`;
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

/** Verify every wired handler is imported (or local) and exported from its module. */
export async function lintDashboardHandlerExports(
  repoRoot: string,
  routesSource: string,
  options: { exportCache?: Map<string, Set<string>> } = {}
): Promise<string[]> {
  const violations: string[] = [];
  const wired = wiredDashboardRouteHandlers(routesSource);
  const imports = parseRoutesHandlerImports(routesSource);
  const locals = new Set<string>();
  for (const match of routesSource.matchAll(/(?:async\s+)?function\s+(api[A-Z]\w*)/g)) {
    locals.add(match[1]!);
  }
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
      const source = await Bun.file(filePath).text();
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
