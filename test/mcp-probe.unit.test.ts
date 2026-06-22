import { describe, expect, test } from "bun:test";
import {
  callMcpToolHttp,
  clearProbeCache,
  extractToolDescriptions,
  parseSseMessages,
  probeMcpServer,
  probeMcpServerCached,
  probeMcpServerWithDescriptions,
} from "../src/lib/mcp-probe.ts";
import { BUN_DOCS_MCP_TOOLS, BUN_DOCS_MCP_URL, BUN_DOCS_SERVER } from "../src/lib/mcp-registry.ts";

describe("mcp-probe", () => {
  test("parseSseMessages extracts single data payload", () => {
    const text = 'event: message\ndata: {"result":{"tools":[]}}\n\n';
    expect(parseSseMessages(text)).toEqual(['{"result":{"tools":[]}}']);
  });

  test("parseSseMessages joins multi-line data payloads", () => {
    const text = 'data: {"foo":\ndata: "bar"}\n\n';
    expect(parseSseMessages(text)).toEqual(['{"foo":"bar"}']);
  });

  test("parseSseMessages skips [DONE] and comments", () => {
    const text = ':comment\ndata: {"result":1}\ndata: [DONE]\n\n';
    expect(parseSseMessages(text)).toEqual(['{"result":1}']);
  });

  test("parseSseMessages handles CRLF line endings", () => {
    const text = 'event: message\r\ndata: {"ok":true}\r\n\r\n';
    expect(parseSseMessages(text)).toEqual(['{"ok":true}']);
  });

  test("parseSseMessages returns empty array when no data lines", () => {
    expect(parseSseMessages("event: ping\n\n")).toEqual([]);
  });

  test("extractToolDescriptions parses tools/list payloads", () => {
    const tools = extractToolDescriptions({
      tools: [
        { name: "search_bun", description: "Search docs" },
        { name: "query_docs_filesystem_bun", description: "Read docs FS" },
      ],
    });
    expect(tools).toEqual([
      { name: "search_bun", description: "Search docs" },
      { name: "query_docs_filesystem_bun", description: "Read docs FS" },
    ]);
  });

  test("probeMcpServer discovers bun-docs tools over SSE", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    const result = await probeMcpServer({ name: BUN_DOCS_SERVER, url: BUN_DOCS_MCP_URL }, 15000);
    expect(result.ok).toBe(true);
    for (const tool of BUN_DOCS_MCP_TOOLS) {
      expect(result.tools).toContain(tool);
    }
  });

  test("probeMcpServerCached returns cached result on second call", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    clearProbeCache();
    const server = { name: BUN_DOCS_SERVER, url: BUN_DOCS_MCP_URL };
    const first = await probeMcpServerCached(server, 15000);
    expect(first.ok).toBe(true);
    expect(first.cached).toBeFalsy();
    const second = await probeMcpServerCached(server, 15000);
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(true);
    clearProbeCache();
  });

  test("probeMcpServerWithDescriptions returns tool names + descriptions", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    const result = await probeMcpServerWithDescriptions(
      { name: BUN_DOCS_SERVER, url: BUN_DOCS_MCP_URL },
      15000
    );
    expect(result.ok).toBe(true);
    expect(result.tools?.length).toBeGreaterThan(0);
    expect(result.toolDescriptions).toBeDefined();
    expect(result.toolDescriptions!.length).toBe(result.tools!.length);
    for (const tool of BUN_DOCS_MCP_TOOLS) {
      expect(result.tools).toContain(tool);
    }
  });

  test("callMcpToolHttp calls search_bun on bun-docs MCP", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    const result = await callMcpToolHttp(
      { name: BUN_DOCS_SERVER, url: BUN_DOCS_MCP_URL },
      "search_bun",
      { query: "Bun.spawn" },
      30000
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBeDefined();
  });
});
