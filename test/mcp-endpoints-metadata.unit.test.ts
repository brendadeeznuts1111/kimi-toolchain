import { describe, expect, test } from "bun:test";
import {
  BUN_DOCS_MCP_WORKFLOW,
  BUN_DOCS_TOOLS,
  buildBuiltinMcpCatalog,
  expectedToolNames,
  mcpCatalogSummary,
  mcpEndpointForServer,
  validateDiscoveredTools,
} from "../src/lib/mcp-endpoints-metadata.ts";
import { BUN_DOCS_MCP_URL, BUN_DOCS_SERVER } from "../src/lib/mcp-registry.ts";

describe("mcp-endpoints-metadata", () => {
  test("mcpCatalogSummary counts builtin servers and tools", () => {
    const summary = mcpCatalogSummary("/tmp");
    expect(summary.builtin).toBe(4);
    expect(summary.defaultEnabled).toBe(3);
    expect(summary.toolCount).toBeGreaterThan(8);
    expect(summary.transports["http-sse"]).toBe(2);
    expect(summary.transports.stdio).toBe(2);
  });

  test("bun-docs catalog entry documents live MCP tools", () => {
    const bunDocs = mcpEndpointForServer(BUN_DOCS_SERVER, "/tmp");
    expect(bunDocs?.endpoint).toBe(BUN_DOCS_MCP_URL);
    expect(bunDocs?.transport).toBe("http-sse");
    expect(bunDocs?.doctorCheckId).toBe("bun-docs-mcp");
    expect(expectedToolNames(bunDocs!)).toEqual(BUN_DOCS_TOOLS.map((t) => t.name));
    expect(BUN_DOCS_MCP_WORKFLOW.searchTool).toBe("search_bun");
    expect(BUN_DOCS_MCP_WORKFLOW.semverDocPath).toBe("runtime/semver.mdx");
  });

  test("dashboard catalog includes version_policy tool", () => {
    const dashboard = mcpEndpointForServer("kimi-dashboard", "/tmp");
    expect(dashboard?.tools.some((tool) => tool.name === "version_policy")).toBe(true);
  });

  test("validateDiscoveredTools flags missing catalog tools", () => {
    const meta = buildBuiltinMcpCatalog("/tmp").find((e) => e.serverName === BUN_DOCS_SERVER)!;
    const drift = validateDiscoveredTools(meta, ["search_bun"]);
    expect(drift.missing).toContain("query_docs_filesystem_bun");
    expect(drift.extra).toEqual([]);
  });
});
