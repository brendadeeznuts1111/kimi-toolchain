/**
 * Canvas companion SSOT — manifest routes and hub stats derived from repo files.
 */

import { join } from "path";
import { LOCAL_DOC_REFERENCES } from "./canonical-references.ts";
import { INTEGRATION_TEST_FILES, SMOKE_TEST_FILES, UNIT_TEST_FILES } from "./test-gates.ts";
import { listPackageBinNames } from "./tool-registry.ts";

const CANVAS_DIR = "docs/canvases";
const CANVAS_SUFFIX = ".canvas.tsx";

export type HubBinCategory = "diag" | "gov" | "heal" | "scaffold" | "herdr" | "infra";

const BIN_CATEGORY: Record<string, HubBinCategory> = {
  "kimi-doctor": "diag",
  "kimi-debug": "diag",
  "kimi-deep-audit": "diag",
  "kimi-capabilities": "diag",
  "kimi-trace": "diag",
  "kimi-orphan-kill": "diag",
  "kimi-config": "diag",
  "kimi-identity": "diag",
  "kimi-governance": "gov",
  "kimi-guardian": "gov",
  "kimi-githooks": "gov",
  "kimi-cloudflare-access": "gov",
  "kimi-secrets": "gov",
  "kimi-contract": "gov",
  "kimi-heal": "heal",
  "kimi-memory": "heal",
  "kimi-snapshot": "heal",
  "kimi-decision": "heal",
  "kimi-error": "heal",
  "kimi-why": "heal",
  "kimi-resource-governor": "heal",
  "kimi-fix": "scaffold",
  "kimi-new": "scaffold",
  "kimi-context-gen": "scaffold",
  "kimi-cleanup-legacy": "scaffold",
  "kimi-release": "scaffold",
  "kimi-bake": "scaffold",
  "herdr-doctor": "herdr",
  "herdr-orchestrator": "herdr",
  "herdr-project": "herdr",
  "herdr-pane": "herdr",
  "herdr-spawn": "herdr",
  "herdr-latm": "herdr",
  "kimi-toolchain": "infra",
  "kimi-dashboard": "infra",
  "kimi-mcp": "infra",
  "kimi-dashboard-mcp": "infra",
  "unified-shell-bridge": "infra",
};

const CATEGORY_LABELS: Record<HubBinCategory, string> = {
  diag: "Diagnostics",
  gov: "Governance",
  heal: "Heal / Memory",
  scaffold: "Scaffold",
  herdr: "Herdr",
  infra: "Router / Bridge",
};

const CATEGORY_ORDER: HubBinCategory[] = ["diag", "gov", "heal", "scaffold", "herdr", "infra"];

/** Table row labels on kimi-toolchain.canvas.tsx (may differ from CATEGORY_LABELS). */
const INVENTORY_ROW_LABELS: Record<HubBinCategory, string> = {
  diag: "Diagnostics",
  gov: "Governance / Security",
  heal: "Heal / Memory",
  scaffold: "Scaffold / Release",
  herdr: "Herdr",
  infra: "Infrastructure",
};

const INVENTORY_BIN_LABELS: Partial<Record<string, string>> = {
  "kimi-toolchain": "kimi-toolchain (router)",
  "kimi-mcp": "kimi-mcp (MCP stdio)",
  "kimi-dashboard-mcp": "kimi-dashboard-mcp (MCP stdio)",
  "unified-shell-bridge": "unified-shell-bridge (MCP stdio)",
  "kimi-resource-governor": "kimi-resource-governor (health-listen)",
};

export const HUB_BIN_CATEGORY = BIN_CATEGORY;

export interface ManifestCanvasRoute {
  manifestId: string;
  canvasId: string;
  page: string;
  path: string;
  readOrder: number;
  version?: string;
  layer?: string;
  openWhen?: string;
}

export interface HubToolchainStats {
  binCount: number;
  libCount: number;
  unitCount: number;
  integrationCount: number;
  smokeCount: number;
  canvasCount: number;
  toolCategories: Array<{ id: HubBinCategory; label: string; count: number }>;
}

export function manifestCanvasRoutes(): ManifestCanvasRoute[] {
  return LOCAL_DOC_REFERENCES.filter((entry) => entry.cursorCanvas && entry.canvasId)
    .map((entry) => ({
      manifestId: entry.id,
      canvasId: entry.canvasId!,
      page: entry.canvasPage ?? entry.canvasId!,
      path: entry.cursorCanvas!,
      readOrder: entry.canvasReadOrder ?? 99,
      version: entry.canvasVersion,
      layer: entry.canvasLayer,
      openWhen: entry.canvasOpenWhen,
    }))
    .sort((a, b) => a.readOrder - b.readOrder || a.canvasId.localeCompare(b.canvasId));
}

export function canvasCompanionFiles(repoRoot: string): string[] {
  const pattern = `${CANVAS_DIR}/*${CANVAS_SUFFIX}`;
  const glob = new Bun.Glob(pattern);
  return Array.from(glob.scanSync({ cwd: repoRoot, onlyFiles: true }))
    .map((p) => p.replace(`${CANVAS_DIR}/`, ""))
    .sort();
}

function canvasIdFromRelPath(rel: string): string {
  return rel.replace(`${CANVAS_DIR}/`, "").replace(CANVAS_SUFFIX, "");
}

function routeDetail(route: ManifestCanvasRoute, forCanvasId: string): string {
  if (route.canvasId === forCanvasId) {
    return `manifest id ${route.manifestId} (this canvas)`;
  }
  return route.openWhen ?? `manifest id ${route.manifestId}`;
}

function escapeTsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface ManifestLocalDocRow {
  id: string;
  location: "docs/references" | "repo root";
  purpose: string;
}

function localDocLocation(repoPath: string): ManifestLocalDocRow["location"] {
  return repoPath.startsWith("docs/references/") ? "docs/references" : "repo root";
}

/** All LOCAL_DOC_REFERENCES rows for herdr-dashboard-thumbnails.canvas.tsx. */
export function manifestLocalDocsRows(): ManifestLocalDocRow[] {
  return LOCAL_DOC_REFERENCES.map((entry) => ({
    id: entry.id,
    location: localDocLocation(entry.repoPath),
    purpose: entry.purpose,
  }));
}

export function renderManifestLocalDocsBlock(): string {
  const lines = manifestLocalDocsRows().map((doc) => {
    return `  { id: "${doc.id}", location: "${doc.location}", purpose: "${escapeTsString(doc.purpose)}" }`;
  });
  return `const MANIFEST_LOCAL_DOCS_ALL = [\n${lines.join(",\n")},\n] as const;`;
}

/** Table row tones for RelatedCanvasesTable — self highlighted, hub uses namespace highlight. */
export function routingRowTones(forCanvasId: string): readonly string[] {
  const routes = manifestCanvasRoutes();

  if (forCanvasId === "kimi-toolchain") {
    return routes.map((route, i) => {
      if (route.canvasId === "namespace-boundaries") return "success";
      if (route.canvasId === "herdr-unified-plugin-architecture") return "warning";
      if (route.canvasId === "kimi-heal-doctor-scaffold") return "warning";
      if (i === 0) return "info";
      return "neutral";
    });
  }

  const selfIndex = routes.findIndex((route) => route.canvasId === forCanvasId);
  return routes.map((route, i) => {
    if (i === selfIndex) return "success";
    if (i === 0) return "info";
    if (route.canvasId === "herdr-unified-plugin-architecture") return "warning";
    if (route.canvasId === "doc-links-and-see-ladder") return "warning";
    if (route.canvasId === "kimi-heal-doctor-scaffold" && i === routes.length - 1) return "warning";
    return "neutral";
  });
}

export function renderCanvasRoutingMetaBlock(forCanvasId: string, docLinks = false): string {
  const toneName = docLinks ? "CANVAS_ROW_TONE" : "CANVAS_ROUTING_ROW_TONE";
  const toneLines = routingRowTones(forCanvasId)
    .map((tone) => `  "${tone}"`)
    .join(",\n");
  return [
    "const CANVAS_ROUTING_COUNT = CANVAS_ROUTING.length;",
    "",
    `const ${toneName} = [`,
    toneLines,
    "] as const;",
  ].join("\n");
}

/** Standard CANVAS_ROUTING block for eight hub/topic canvases (not doc-links). */
export function renderSimpleCanvasRoutingBlock(forCanvasId: string): string {
  const lines = manifestCanvasRoutes().map((route) => {
    const detail = routeDetail(route, forCanvasId);
    const parts = [
      `id: "${route.canvasId}"`,
      `page: "${escapeTsString(route.page)}"`,
      `path: "${route.path}"`,
    ];
    if (detail) parts.push(`detail: "${escapeTsString(detail)}"`);
    return `  { ${parts.join(", ")} }`;
  });
  return `const CANVAS_ROUTING = [\n${lines.join(",\n")},\n] as const;`;
}

/** Extended CANVAS_ROUTING for doc-links-and-see-ladder.canvas.tsx. */
export function renderExtendedCanvasRoutingBlock(): string {
  const lines = manifestCanvasRoutes().map((route) => {
    const version =
      route.version != null ? `"${escapeTsString(route.version)}"` : "TOOLCHAIN_VERSION";
    return `  {
    id: "${route.canvasId}",
    page: "${escapeTsString(route.page)}",
    version: ${version},
    layer: "${escapeTsString(route.layer ?? route.page)}",
    openWhen: "${escapeTsString(route.openWhen ?? route.page)}",
    path: \`\${CANVAS_PREFIX}${route.canvasId}.canvas.tsx\`,
    repoPath: \`\${CANVAS_PREFIX}${route.canvasId}.canvas.tsx\`,
  }`;
  });
  return `const CANVAS_ROUTING = [\n${lines.join(",\n")},\n] as const;`;
}

function countLibModules(repoRoot: string): number {
  let count = 0;
  const glob = new Bun.Glob("**/*.ts");
  for (const _ of glob.scanSync({ cwd: join(repoRoot, "src/lib"), onlyFiles: true })) {
    count++;
  }
  return count;
}

export function uncategorizedPackageBins(binNames: readonly string[]): string[] {
  return binNames.filter((name) => !BIN_CATEGORY[name]).sort();
}

function inventoryBinLabel(binName: string): string {
  return INVENTORY_BIN_LABELS[binName] ?? binName;
}

export function renderToolInventoryBlock(binNames: readonly string[]): string {
  const uncategorized = uncategorizedPackageBins(binNames);
  if (uncategorized.length > 0) {
    throw new Error(
      `canvas-companion-data: uncategorized bin(s) ${uncategorized.join(", ")} — extend BIN_CATEGORY`
    );
  }

  const byCategory = new Map<HubBinCategory, string[]>();
  for (const category of CATEGORY_ORDER) byCategory.set(category, []);

  for (const name of [...binNames].sort()) {
    const category = BIN_CATEGORY[name]!;
    byCategory.get(category)!.push(inventoryBinLabel(name));
  }

  const rows = CATEGORY_ORDER.map((category) => {
    const label = INVENTORY_ROW_LABELS[category];
    const tools = byCategory.get(category)!.join(", ");
    return `  ["${escapeTsString(label)}", "${escapeTsString(tools)}"]`;
  });

  return `const TOOL_INVENTORY = [\n${rows.join(",\n")},\n] as const;`;
}

function categorizeBins(binNames: string[]): Map<HubBinCategory, number> {
  const counts = new Map<HubBinCategory, number>();
  for (const category of CATEGORY_ORDER) counts.set(category, 0);

  for (const name of binNames) {
    const category = BIN_CATEGORY[name];
    if (!category) {
      throw new Error(`canvas-companion-data: uncategorized bin "${name}" — extend BIN_CATEGORY`);
    }
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

export async function computeHubToolchainStats(repoRoot: string): Promise<HubToolchainStats> {
  const binNames = await listPackageBinNames(repoRoot);
  const categoryCounts = categorizeBins(binNames);

  return {
    binCount: binNames.length,
    libCount: countLibModules(repoRoot),
    unitCount: UNIT_TEST_FILES.length,
    integrationCount: INTEGRATION_TEST_FILES.length,
    smokeCount: SMOKE_TEST_FILES.length,
    canvasCount: manifestCanvasRoutes().length,
    toolCategories: CATEGORY_ORDER.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      count: categoryCounts.get(id) ?? 0,
    })),
  };
}

export function renderHubToolchainStatsBlock(stats: HubToolchainStats): string {
  const categoryLines = stats.toolCategories
    .map((c) => `  { id: "${c.id}", label: "${c.label}", count: ${c.count} }`)
    .join(",\n");

  return [
    "const TOOL_CATEGORIES = [",
    categoryLines,
    "] as const;",
    "",
    `const BIN_COUNT = ${stats.binCount};`,
    `const LIB_COUNT = ${stats.libCount};`,
    `const UNIT_COUNT = ${stats.unitCount};`,
    `const INTEGRATION_COUNT = ${stats.integrationCount};`,
    `const SMOKE_COUNT = ${stats.smokeCount};`,
    `const CURSOR_CANVAS_COUNT = ${stats.canvasCount};`,
    "",
  ].join("\n");
}

export const CANVAS_ROUTING_BLOCK_RE =
  /\/\*\* @generated canvas-routing[\s\S]*?\*\/\nconst CANVAS_ROUTING = \[[\s\S]*?\] as const;/;

export const CANVAS_ROUTING_META_BLOCK_RE =
  /\/\*\* @generated canvas-routing-meta[\s\S]*?\*\/\nconst CANVAS_ROUTING_COUNT = CANVAS_ROUTING\.length;\n+const (?:CANVAS_ROUTING_ROW_TONE|CANVAS_ROW_TONE) = \[[\s\S]*?\] as const;/;

export const CANVAS_ROUTING_BUNDLE_RE =
  /\/\*\* @generated canvas-routing[\s\S]*?\*\/\nconst CANVAS_ROUTING = \[[\s\S]*?\] as const;\n+\/\*\* @generated canvas-routing-meta[\s\S]*?\*\/\nconst CANVAS_ROUTING_COUNT = CANVAS_ROUTING\.length;\n+const (?:CANVAS_ROUTING_ROW_TONE|CANVAS_ROW_TONE) = \[[\s\S]*?\] as const;/;

const CANVAS_ROUTING_META_TAIL_RE =
  /\n+\/\*\* @generated canvas-routing-meta[\s\S]*?\*\/\nconst CANVAS_ROUTING_COUNT = CANVAS_ROUTING\.length;\n+const (?:CANVAS_ROUTING_ROW_TONE|CANVAS_ROW_TONE) = \[[\s\S]*?\] as const;\n+/g;

const CANVAS_ROUTING_WITH_OPTIONAL_META_RE =
  /\/\*\* @generated canvas-routing[\s\S]*?\*\/\nconst CANVAS_ROUTING = \[[\s\S]*?\] as const;\n+(?:\/\*\* @generated canvas-routing-meta[\s\S]*?\*\/\nconst CANVAS_ROUTING_COUNT = CANVAS_ROUTING\.length;\n+const (?:CANVAS_ROUTING_ROW_TONE|CANVAS_ROW_TONE) = \[[\s\S]*?\] as const;\n+)*/;

export const MANIFEST_LOCAL_DOCS_BLOCK_RE =
  /\/\*\* @generated manifest-local-docs[\s\S]*?\*\/\nconst MANIFEST_LOCAL_DOCS_ALL = \[[\s\S]*?\] as const;/;

export const MANIFEST_LOCAL_DOCS_LEGACY_RE =
  /\/\*\* All LOCAL_DOC_REFERENCES[\s\S]*?\*\/\nconst MANIFEST_LOCAL_DOCS_ALL = \[[\s\S]*?\] as const;/;

export const HUB_STATS_BLOCK_RE =
  /\/\*\* @generated hub-toolchain-stats[\s\S]*?\*\/\nconst TOOL_CATEGORIES = \[[\s\S]*?\] as const;\n\nconst BIN_COUNT = \d+;\nconst LIB_COUNT = \d+;\nconst UNIT_COUNT = \d+;\nconst INTEGRATION_COUNT = \d+;\nconst SMOKE_COUNT = \d+;\n(?:const CURSOR_CANVAS_COUNT = \d+;\n)?/;

export const HUB_STATS_LEGACY_RE =
  /\nconst BIN_COUNT = \d+;\nconst LIB_COUNT = \d+;\nconst UNIT_COUNT = \d+;\nconst INTEGRATION_COUNT = \d+;\nconst SMOKE_COUNT = \d+;\n(?:const CURSOR_CANVAS_COUNT = \d+;\n)?/;

export const HUB_TOOL_CATEGORIES_LEGACY_RE =
  /const TOOL_CATEGORIES = \[\n(?:  \{ id: "[^"]+", label: "[^"]+", count: \d+ \},?\n)+\] as const;\n\n/;

export function wrapGeneratedCanvasRouting(block: string): string {
  return `/** @generated canvas-routing — bun run canvas:generate; do not edit */\n${block}`;
}

export function wrapGeneratedCanvasRoutingMeta(block: string): string {
  return `/** @generated canvas-routing-meta — bun run canvas:generate; do not edit */\n${block}`;
}

export function wrapGeneratedManifestLocalDocs(block: string): string {
  return `/** @generated manifest-local-docs — bun run canvas:generate; do not edit */\n${block}`;
}

export function wrapGeneratedHubStats(block: string): string {
  return `/** @generated hub-toolchain-stats — bun run canvas:generate; do not edit */\n${block}`;
}

export function wrapGeneratedToolInventory(block: string): string {
  return `/** @generated hub-toolchain-inventory — bun run canvas:generate; do not edit */\n${block}`;
}

export const HUB_INVENTORY_BLOCK_RE =
  /\/\*\* @generated hub-toolchain-inventory[\s\S]*?\*\/\nconst TOOL_INVENTORY = \[[\s\S]*?\] as const;/;

export const HUB_INVENTORY_LEGACY_RE = /const TOOL_INVENTORY = \[[\s\S]*?\] as const;/;

export function expectedCanvasRoutingForFile(relPath: string): string {
  return expectedCanvasRoutingBundle(relPath);
}

export function expectedCanvasRoutingBundle(relPath: string): string {
  const canvasId = canvasIdFromRelPath(relPath);
  const docLinks = canvasId === "doc-links-and-see-ladder";
  const routingBody = docLinks
    ? renderExtendedCanvasRoutingBlock()
    : renderSimpleCanvasRoutingBlock(canvasId);
  const routing = wrapGeneratedCanvasRouting(routingBody);
  const meta = wrapGeneratedCanvasRoutingMeta(renderCanvasRoutingMetaBlock(canvasId, docLinks));
  return `${routing}\n\n${meta}`;
}

function scrubOrphanRoutingMetaComments(source: string): string {
  return source.replace(
    /\/\*\* @generated canvas-routing-meta[\s\S]*?\*\/\n+(?=\/\*\* @generated canvas-routing-meta)/g,
    ""
  );
}

function dedupeCanvasRoutingMeta(source: string): string {
  let seen = false;
  return source.replace(CANVAS_ROUTING_META_TAIL_RE, (match) => {
    if (seen) return "";
    seen = true;
    return match;
  });
}

export function patchCanvasRouting(source: string, relPath: string): string {
  const replacement = `${expectedCanvasRoutingBundle(relPath)}\n`;
  let next = source;

  if (CANVAS_ROUTING_WITH_OPTIONAL_META_RE.test(source)) {
    next = source.replace(CANVAS_ROUTING_WITH_OPTIONAL_META_RE, replacement);
  } else if (CANVAS_ROUTING_BUNDLE_RE.test(source)) {
    next = source.replace(CANVAS_ROUTING_BUNDLE_RE, replacement.trimEnd());
  } else if (CANVAS_ROUTING_BLOCK_RE.test(source)) {
    next = source.replace(CANVAS_ROUTING_BLOCK_RE, replacement.trimEnd());
  } else {
    const legacy = /const CANVAS_ROUTING = \[[\s\S]*?\] as const;/;
    if (!legacy.test(source)) {
      throw new Error(`${relPath}: missing CANVAS_ROUTING block`);
    }
    next = source.replace(legacy, replacement.trimEnd());
  }

  next = dedupeCanvasRoutingMeta(next);
  next = scrubOrphanRoutingMetaComments(next);
  return next;
}

export function patchManifestLocalDocs(source: string): string {
  const replacement = wrapGeneratedManifestLocalDocs(renderManifestLocalDocsBlock());
  if (MANIFEST_LOCAL_DOCS_BLOCK_RE.test(source)) {
    return source.replace(MANIFEST_LOCAL_DOCS_BLOCK_RE, replacement);
  }
  if (MANIFEST_LOCAL_DOCS_LEGACY_RE.test(source)) {
    return source.replace(MANIFEST_LOCAL_DOCS_LEGACY_RE, replacement);
  }
  throw new Error("herdr-dashboard-thumbnails.canvas.tsx: missing MANIFEST_LOCAL_DOCS_ALL block");
}

export function patchHubToolchainInventory(source: string, binNames: readonly string[]): string {
  const replacement = wrapGeneratedToolInventory(renderToolInventoryBlock(binNames));
  if (HUB_INVENTORY_BLOCK_RE.test(source)) {
    return source.replace(HUB_INVENTORY_BLOCK_RE, replacement);
  }
  if (HUB_INVENTORY_LEGACY_RE.test(source)) {
    return source.replace(HUB_INVENTORY_LEGACY_RE, replacement);
  }
  throw new Error("kimi-toolchain.canvas.tsx: missing TOOL_INVENTORY block");
}

export { listPackageBinNames };

export function patchHubToolchainCanvas(
  source: string,
  stats: HubToolchainStats,
  binNames: readonly string[]
): string {
  return patchHubToolchainStats(patchHubToolchainInventory(source, binNames), stats);
}

export function patchHubToolchainStats(source: string, stats: HubToolchainStats): string {
  const replacement = wrapGeneratedHubStats(renderHubToolchainStatsBlock(stats));
  let next = source;

  if (HUB_STATS_BLOCK_RE.test(source)) {
    next = source.replace(HUB_STATS_BLOCK_RE, replacement);
  } else if (HUB_STATS_LEGACY_RE.test(source)) {
    next = source.replace(HUB_STATS_LEGACY_RE, `\n${replacement}`);
    if (HUB_TOOL_CATEGORIES_LEGACY_RE.test(next)) {
      next = next.replace(HUB_TOOL_CATEGORIES_LEGACY_RE, "");
    }
  } else {
    throw new Error("kimi-toolchain.canvas.tsx: missing hub stats block");
  }

  next = next.replace(
    /\["Fast iterate", "bun run check:fast", "~3s · \d+ unit files @ 1500ms", "Local TDD"\]/,
    `["Fast iterate", "bun run check:fast", "~3s · ${stats.unitCount} unit files @ 1500ms", "Local TDD"]`
  );
  next = next.replace(
    /\{ id: "test", label: "bun run check:fast", sub: "\d+ unit gates" \}/,
    `{ id: "test", label: "bun run check:fast", sub: "${stats.unitCount} unit gates" }`
  );
  return next;
}
