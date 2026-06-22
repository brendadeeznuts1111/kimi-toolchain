/**
 * MCP server catalog — transport, tools, doctor checks, and probe metadata (SSOT).
 */

import {
  BUN_DOCS_MCP_URL,
  BUN_DOCS_SERVER,
  CLOUDFLARE_API_SERVER,
  DASHBOARD_MCP_SERVER,
  UNIFIED_SHELL_BRIDGE,
  UNIFIED_SHELL_SERVER,
  type McpServerDefinition,
} from "./mcp-registry.ts";
import { CLOUDFLARE_MCP_URL } from "./mcp-registry.ts";
import { homeDir, toolsDir } from "./paths.ts";
import { join } from "path";

export const MCP_ENDPOINTS_SCHEMA_VERSION = 1;

export type McpTransport = "stdio" | "http-sse";

export type McpEndpointLayer = "shell" | "cloudflare" | "docs" | "dashboard" | "custom";

export interface McpToolMeta {
  name: string;
  title?: string;
  description: string;
  readOnly?: boolean;
}

export interface McpEndpointMeta {
  id: string;
  serverName: string;
  transport: McpTransport;
  /** Remote URL or local bridge script (repo-relative when under ~/.kimi-code). */
  endpoint: string;
  entry: string;
  layer: McpEndpointLayer;
  default: boolean;
  profiles: readonly string[];
  requiredEnv: readonly string[];
  doctorCheckId?: string;
  /** Kimi Code tool id prefix, e.g. mcp__bun-docs__search_bun */
  kimiToolPrefix?: string;
  description: string;
  provisionCommand: string;
  probeNotes?: string;
  tools: readonly McpToolMeta[];
}

export const UNIFIED_SHELL_TOOLS: readonly McpToolMeta[] = [
  {
    name: "execute",
    description: "Run shell commands with signal handling and output caps",
    readOnly: false,
  },
];

export const CLOUDFLARE_API_TOOLS: readonly McpToolMeta[] = [
  {
    name: "search",
    title: "Search Cloudflare API",
    description: "Search Cloudflare API surface for Code Mode execution",
    readOnly: true,
  },
  {
    name: "execute",
    title: "Execute Cloudflare API call",
    description: "Execute a Cloudflare API call discovered via search",
    readOnly: false,
  },
];

export const BUN_DOCS_TOOLS: readonly McpToolMeta[] = [
  {
    name: "search_bun",
    title: "Search documentation",
    description:
      "Semantic search across Bun docs — use for broad or conceptual queries (API names, errors, guides)",
    readOnly: true,
  },
  {
    name: "query_docs_filesystem_bun",
    description:
      "Read-only virtual docs filesystem — use head/cat/rg/tree on .mdx paths (append .mdx to search paths)",
    readOnly: true,
  },
];

export const DASHBOARD_MCP_TOOLS: readonly McpToolMeta[] = [
  { name: "project_status", description: "Project health summary", readOnly: true },
  { name: "health_snapshot", description: "Live health channel snapshot", readOnly: true },
  { name: "effect_gates", description: "Effect gate registry status", readOnly: true },
  { name: "doctor_runs", description: "Recent kimi-doctor run artifacts", readOnly: true },
  { name: "debug_logs", description: "Tail debug log excerpts", readOnly: true },
];

function bridgePath(home: string): string {
  return join(toolsDir(home), UNIFIED_SHELL_BRIDGE);
}

function dashboardMcpPath(home: string): string {
  return join(toolsDir(home), "kimi-dashboard-mcp.ts");
}

/** Built-in MCP catalog (excludes user ~/.kimi-code/mcp-servers/*.toml). */
export function buildBuiltinMcpCatalog(home: string = homeDir()): readonly McpEndpointMeta[] {
  return [
    {
      id: "mcp-unified-shell",
      serverName: UNIFIED_SHELL_SERVER,
      transport: "stdio",
      endpoint: bridgePath(home),
      entry: "src/bin/unified-shell-bridge.ts",
      layer: "shell",
      default: true,
      profiles: ["full", "safe"],
      requiredEnv: [],
      doctorCheckId: "unified-shell",
      kimiToolPrefix: "mcp__unified-shell__",
      description: "Bun-native shell execution bridge synced to ~/.kimi-code/tools/",
      provisionCommand: "bun run sync",
      probeNotes: "stdio JSON-RPC — initialize then tools/list",
      tools: UNIFIED_SHELL_TOOLS,
    },
    {
      id: "mcp-cloudflare-api",
      serverName: CLOUDFLARE_API_SERVER,
      transport: "http-sse",
      endpoint: CLOUDFLARE_MCP_URL,
      entry: "remote:cloudflare.com/mcp",
      layer: "cloudflare",
      default: true,
      profiles: ["full"],
      requiredEnv: ["CLOUDFLARE_API_TOKEN"],
      doctorCheckId: "cloudflare-api-mcp",
      kimiToolPrefix: "mcp__cloudflare__",
      description: "Cloudflare API Code Mode — search + execute",
      provisionCommand: "bun run sync",
      probeNotes: "Requires CLOUDFLARE_API_TOKEN for full probe",
      tools: CLOUDFLARE_API_TOOLS,
    },
    {
      id: "mcp-bun-docs",
      serverName: BUN_DOCS_SERVER,
      transport: "http-sse",
      endpoint: BUN_DOCS_MCP_URL,
      entry: "remote:bun.com/docs/mcp",
      layer: "docs",
      default: true,
      profiles: ["full", "safe"],
      requiredEnv: [],
      doctorCheckId: "bun-docs-mcp",
      kimiToolPrefix: "mcp__bun-docs__",
      description: "Official Bun documentation MCP (SSE JSON-RPC)",
      provisionCommand: "bun run sync",
      probeNotes: "Accept: application/json, text/event-stream — tools/list over SSE",
      tools: BUN_DOCS_TOOLS,
    },
    {
      id: "mcp-kimi-dashboard",
      serverName: DASHBOARD_MCP_SERVER,
      transport: "stdio",
      endpoint: dashboardMcpPath(home),
      entry: "src/bin/kimi-dashboard-mcp.ts",
      layer: "dashboard",
      default: false,
      profiles: ["full"],
      requiredEnv: [],
      doctorCheckId: "mcp-server-kimi-dashboard",
      kimiToolPrefix: "mcp__kimi-dashboard__",
      description: "Read-only examples dashboard probes (opt-in default)",
      provisionCommand: "kimi-mcp add kimi-dashboard --command bun --args run --args <path>",
      tools: DASHBOARD_MCP_TOOLS,
    },
  ];
}

export function mcpEndpointForServer(
  serverName: string,
  home: string = homeDir()
): McpEndpointMeta | undefined {
  return buildBuiltinMcpCatalog(home).find((entry) => entry.serverName === serverName);
}

export function mcpCatalogSummary(home: string = homeDir()): {
  schemaVersion: number;
  configPath: string;
  builtin: number;
  defaultEnabled: number;
  layers: Record<McpEndpointLayer, number>;
  transports: Record<McpTransport, number>;
  toolCount: number;
} {
  const catalog = buildBuiltinMcpCatalog(home);
  const layers = {} as Record<McpEndpointLayer, number>;
  const transports = {} as Record<McpTransport, number>;
  let toolCount = 0;
  for (const entry of catalog) {
    layers[entry.layer] = (layers[entry.layer] ?? 0) + 1;
    transports[entry.transport] = (transports[entry.transport] ?? 0) + 1;
    toolCount += entry.tools.length;
  }
  return {
    schemaVersion: MCP_ENDPOINTS_SCHEMA_VERSION,
    configPath: join(home, ".kimi-code", "mcp.json"),
    builtin: catalog.length,
    defaultEnabled: catalog.filter((e) => e.default).length,
    layers,
    transports,
    toolCount,
  };
}

export interface McpProbeSnapshot {
  serverName: string;
  ok: boolean;
  ms: number;
  tools: string[];
  error?: string;
  configured: boolean;
  enabled: boolean;
  envAvailable: boolean;
  cached?: boolean;
}

export interface McpCatalogReport {
  metadata: ReturnType<typeof mcpCatalogSummary>;
  catalog: readonly McpEndpointMeta[];
  probes: McpProbeSnapshot[];
}

/** Merge registry definition with catalog metadata for doctor/list JSON. */
export function enrichServerFromCatalog(
  def: McpServerDefinition,
  home: string = homeDir()
): McpEndpointMeta | null {
  const meta = mcpEndpointForServer(def.name, home);
  if (!meta) return null;
  return {
    ...meta,
    endpoint: def.url ?? def.args?.join(" ") ?? meta.endpoint,
    description: def.description ?? meta.description,
  };
}

export function expectedToolNames(meta: McpEndpointMeta): string[] {
  return meta.tools.map((tool) => tool.name);
}

export function validateDiscoveredTools(
  meta: McpEndpointMeta,
  discovered: string[]
): { missing: string[]; extra: string[] } {
  const expected = new Set(expectedToolNames(meta));
  const found = new Set(discovered);
  return {
    missing: [...expected].filter((name) => !found.has(name)),
    extra: [...found].filter((name) => !expected.has(name)),
  };
}

/** Bun docs MCP workflow — SSOT for agent skills. */
export const BUN_DOCS_MCP_WORKFLOW = {
  searchTool: "search_bun",
  readTool: "query_docs_filesystem_bun",
  acceptHeader: "application/json, text/event-stream",
  readPattern: "head -200 /path/from/search.mdx",
  searchWhen: "broad API/error/concept queries",
  readWhen: "exact keyword/regex or full page content",
} as const;
