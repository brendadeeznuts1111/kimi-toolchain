/**
 * Bun Docs MCP — high-level interface for querying Bun documentation via MCP.
 *
 * Wraps the low-level mcp-probe functions with Bun-specific conveniences:
 * - searchBunDocs: calls `search_bun` tool
 * - queryBunDocsFilesystem: calls `query_docs_filesystem_bun` tool
 * - probeBunDocs: returns tool list + descriptions for dashboard/doctor display
 * - tool count stability check against expected tools
 */

import {
  BUN_DOCS_MCP_TOOLS,
  BUN_DOCS_MCP_URL,
  BUN_DOCS_SERVER,
  type McpServerDefinition,
} from "./mcp-registry.ts";
import { createHttpMcpClientFromServer } from "./mcp/sse.ts";
import {
  probeMcpServerCached,
  probeMcpServerWithDescriptions,
  type McpProbeWithDescriptionsResult,
  type ToolDescription,
} from "./mcp-probe.ts";

let bunDocsClient: ReturnType<typeof createHttpMcpClientFromServer> | undefined;

function getBunDocsClient() {
  if (!bunDocsClient) {
    bunDocsClient = createHttpMcpClientFromServer(bunDocsServerDef(), { cacheDbPath: true });
  }
  return bunDocsClient;
}

/** Clear Bun docs MCP caches (tool list + tool calls). */
export function clearBunDocsMcpCache(): void {
  bunDocsClient?.clearCache();
  bunDocsClient = undefined;
}

/** Canonical server definition for the Bun docs MCP. */
export function bunDocsServerDef(): McpServerDefinition {
  return {
    name: BUN_DOCS_SERVER,
    url: BUN_DOCS_MCP_URL,
  };
}

/** Result of a Bun docs search query. */
export interface BunDocsSearchResult {
  ok: boolean;
  content?: unknown;
  error?: string;
  latencyMs: number;
  cached?: boolean;
  attempts?: number;
}

/** Format MCP tool result content for CLI / dashboard display. */
export function formatBunDocsContent(content: unknown): string {
  if (typeof content === "string") return content;
  const blocks = (content as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n\n");
  }
  return Bun.inspect(content);
}

/** Alias for generic MCP tool output formatting (same implementation as formatBunDocsContent). */
export const formatMcpToolContent = formatBunDocsContent;

async function callBunDocsTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  refresh = false
): Promise<BunDocsSearchResult> {
  try {
    const client = getBunDocsClient();
    const { result, latencyMs, cached, attempts } = await client.callTool(toolName, args, {
      timeoutMs,
      refresh,
    });
    return { ok: true, content: result, latencyMs, cached, attempts };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
      latencyMs: 0,
    };
  }
}

/** Search Bun documentation via the `search_bun` MCP tool. */
export async function searchBunDocs(
  query: string,
  timeoutMs: number = 30000,
  options?: { refresh?: boolean }
): Promise<BunDocsSearchResult> {
  return callBunDocsTool("search_bun", { query }, timeoutMs, options?.refresh);
}

/** Query Bun docs filesystem via the `query_docs_filesystem_bun` MCP tool. */
export async function queryBunDocsFilesystem(
  command: string,
  timeoutMs: number = 30000,
  options?: { refresh?: boolean }
): Promise<BunDocsSearchResult> {
  return callBunDocsTool("query_docs_filesystem_bun", { command }, timeoutMs, options?.refresh);
}

/** Probe Bun docs MCP and return tool names + descriptions. */
export async function probeBunDocs(
  timeoutMs: number = 15000
): Promise<McpProbeWithDescriptionsResult> {
  return probeMcpServerWithDescriptions(bunDocsServerDef(), timeoutMs);
}

/** Probe Bun docs MCP with TTL caching (avoids hammering on every doctor run). */
export async function probeBunDocsCached(
  timeoutMs: number = 15000
): Promise<McpProbeWithDescriptionsResult> {
  const cached = await probeMcpServerCached(bunDocsServerDef(), timeoutMs);
  if (cached.cached) {
    return { ...cached, toolDescriptions: undefined };
  }
  return probeMcpServerWithDescriptions(bunDocsServerDef(), timeoutMs);
}

/** Expected tool names for stability checking. */
export const EXPECTED_BUN_DOCS_TOOLS = [...BUN_DOCS_MCP_TOOLS] as readonly string[];

/** Check if probed tools match the expected set. */
export function checkToolStability(probedTools: string[]): {
  stable: boolean;
  missing: string[];
  unexpected: string[];
  expectedCount: number;
  actualCount: number;
} {
  const expected = new Set(EXPECTED_BUN_DOCS_TOOLS);
  const actual = new Set(probedTools);
  const missing = [...expected].filter((t) => !actual.has(t));
  const unexpected = [...actual].filter((t) => !expected.has(t));
  return {
    stable: missing.length === 0 && unexpected.length === 0,
    missing,
    unexpected,
    expectedCount: expected.size,
    actualCount: actual.size,
  };
}

/** Build a knowledge card payload for the governance dashboard. */
export interface BunDocsKnowledgeCard {
  ok: boolean;
  server: string;
  url: string;
  tools: ToolDescription[];
  toolCount: number;
  expectedToolCount: number;
  stability: ReturnType<typeof checkToolStability>;
  latencyMs: number;
  cached: boolean;
  error?: string;
  probedAt: string;
}

/** Build the Bun docs knowledge card for dashboard display. */
export async function buildBunDocsKnowledgeCard(
  timeoutMs: number = 15000
): Promise<BunDocsKnowledgeCard> {
  const result = await probeBunDocsCached(timeoutMs);
  const stability = checkToolStability(result.tools ?? []);
  return {
    ok: result.ok,
    server: BUN_DOCS_SERVER,
    url: BUN_DOCS_MCP_URL,
    tools: result.toolDescriptions ?? [],
    toolCount: result.tools?.length ?? 0,
    expectedToolCount: EXPECTED_BUN_DOCS_TOOLS.length,
    stability,
    latencyMs: result.latencyMs,
    cached: result.cached ?? false,
    error: result.error,
    probedAt: new Date().toISOString(),
  };
}
