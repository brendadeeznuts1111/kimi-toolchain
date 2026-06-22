/**
 * Bun Docs MCP doctor gate — health check for the Bun docs MCP server.
 */

import { loadMCPClient } from "../lib/mcp/sse.ts";

export interface BunDocsAuditResult {
  dimension: 12;
  gate: "bun-docs-mcp";
  ok: boolean;
  toolsAvailable?: number;
  query: string;
  result?: unknown;
  error?: string;
}

/**
 * Audit the Bun docs MCP server by listing tools and executing a sample query.
 * Returns a health-check dimension result compatible with the doctor pipeline.
 */
export async function auditBunDocs(query = "latest Bun version"): Promise<BunDocsAuditResult> {
  try {
    const client = await loadMCPClient("bun-docs");
    const tools = await client.listTools();
    const toolName = selectBunDocsTool(tools);
    const result = await client.callTool(toolName, { query });

    return {
      dimension: 12,
      gate: "bun-docs-mcp",
      ok: true,
      toolsAvailable: tools.length,
      query,
      result: typeof result === "string" ? result.slice(0, 200) : result,
    };
  } catch (err) {
    return {
      dimension: 12,
      gate: "bun-docs-mcp",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      query,
    };
  }
}

function selectBunDocsTool(tools: Array<{ name: string; description: string }>): string {
  const preferred = ["search_bun", "query_docs_filesystem_bun"];
  for (const name of preferred) {
    if (tools.some((t) => t.name === name)) return name;
  }
  return tools[0]?.name ?? "search_bun";
}
