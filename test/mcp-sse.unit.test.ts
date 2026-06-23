/**
 * mcp/sse.ts — SSE JSON-RPC parsing and HTTP MCP client regression guard.
 *
 * @see src/lib/mcp/sse.ts
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearPersistentMcpCacheForUrl,
  createHttpMcpClient,
  decodeJsonRpcMessages,
  extractMcpTools,
  formatMcpStreamError,
  parseSseMessages,
  selectTerminalJsonRpcMessage,
  type JsonRpcMessage,
} from "../src/lib/mcp/sse.ts";
import { BUN_DOCS_MCP_TOOLS, BUN_DOCS_MCP_URL } from "../src/lib/mcp-registry.ts";

describe("mcp-sse", () => {
  describe("parseSseMessages", () => {
    test("extracts single data payload", () => {
      const text = 'event: message\ndata: {"result":{"tools":[]}}\n\n';
      expect(parseSseMessages(text)).toEqual(['{"result":{"tools":[]}}']);
    });

    test("joins multi-line data payloads", () => {
      const text = 'data: {"foo":\ndata: "bar"}\n\n';
      expect(parseSseMessages(text)).toEqual(['{"foo":"bar"}']);
    });

    test("skips [DONE] and comments", () => {
      const text = ':comment\ndata: {"result":1}\ndata: [DONE]\n\n';
      expect(parseSseMessages(text)).toEqual(['{"result":1}']);
    });

    test("handles CRLF line endings", () => {
      const text = 'event: message\r\ndata: {"ok":true}\r\n\r\n';
      expect(parseSseMessages(text)).toEqual(['{"ok":true}']);
    });
  });

  test("selectTerminalJsonRpcMessage prefers matching request id", () => {
    const messages: JsonRpcMessage[] = [
      { jsonrpc: "2.0", id: 1, result: { tools: [] } },
      { jsonrpc: "2.0", id: 2, result: { content: "done" } },
    ];
    expect(selectTerminalJsonRpcMessage(messages, 2)?.result).toEqual({ content: "done" });
  });

  test("selectTerminalJsonRpcMessage falls back to last terminal message", () => {
    const messages: JsonRpcMessage[] = [
      { jsonrpc: "2.0", id: 1, result: { tools: [] } },
      { jsonrpc: "2.0", id: 2, result: { content: "done" } },
    ];
    expect(selectTerminalJsonRpcMessage(messages)?.result).toEqual({ content: "done" });
  });

  describe("decodeJsonRpcMessages", () => {
    test("parses plain JSON bodies", () => {
      const messages = decodeJsonRpcMessages('{"jsonrpc":"2.0","id":1,"result":{}}');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.id).toBe(1);
    });

    test("parses SSE bodies", () => {
      const messages = decodeJsonRpcMessages(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
        "text/event-stream"
      );
      expect(messages[0]?.result).toEqual({ tools: [] });
    });
  });

  describe("extractMcpTools", () => {
    test("maps tools/list payloads", () => {
      const tools = extractMcpTools({
        tools: [
          { name: "search_bun", description: "Search docs" },
          { name: "query_docs_filesystem_bun", description: "Read docs FS" },
        ],
      });
      expect(tools).toEqual([
        { name: "search_bun", description: "Search docs", inputSchema: undefined },
        { name: "query_docs_filesystem_bun", description: "Read docs FS", inputSchema: undefined },
      ]);
    });
  });

  describe("formatMcpStreamError", () => {
    test("includes retry guidance", () => {
      const message = formatMcpStreamError("incomplete SSE stream");
      expect(message).toContain("incomplete SSE stream");
      expect(message).toContain("Try again");
    });
  });

  describe("createHttpMcpClient", () => {
    test("caches tools/list responses", async () => {
      if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
      const client = createHttpMcpClient({
        url: BUN_DOCS_MCP_URL,
        toolListCacheTtlMs: 60_000,
      });
      client.clearCache();
      const first = await client.listTools();
      const second = await client.listTools();
      expect(first.tools.length).toBeGreaterThan(0);
      expect(second.cached).toBe(true);
      for (const tool of BUN_DOCS_MCP_TOOLS) {
        expect(second.tools.map((t) => t.name)).toContain(tool);
      }
    });

    test("retries and returns tool call results", async () => {
      if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
      const client = createHttpMcpClient({
        url: BUN_DOCS_MCP_URL,
        toolCallCacheTtlMs: 60_000,
      });
      client.clearCache();
      const first = await client.callTool("search_bun", { query: "Bun.escapeHTML" });
      const second = await client.callTool("search_bun", { query: "Bun.escapeHTML" });
      expect(first.result).toBeDefined();
      expect(first.attempts).toBeGreaterThanOrEqual(1);
      expect(second.cached).toBe(true);
    });

    test("clearPersistentMcpCacheForUrl clears DB without prior HttpMcpClient", () => {
      const tmpDb = join(tmpdir(), `mcp-clear-${Bun.randomUUIDv7()}.db`);
      const serverUrl = "https://example.com/mcp";
      try {
        const db = new Database(tmpDb);
        db.run("PRAGMA journal_mode=WAL");
        db.run(
          `CREATE TABLE mcp_cache (
            server_url TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            value TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY (server_url, cache_key)
          )`
        );
        db.run(
          "INSERT INTO mcp_cache (server_url, cache_key, value, expires_at) VALUES (?, ?, ?, ?)",
          [serverUrl, "tools/list", "[]", Date.now() + 60_000]
        );
        db.run(
          "INSERT INTO mcp_cache (server_url, cache_key, value, expires_at) VALUES (?, ?, ?, ?)",
          [serverUrl, "tool:search", '{"ok":true}', Date.now() + 60_000]
        );
        db.close();

        clearPersistentMcpCacheForUrl(serverUrl, tmpDb);

        const check = new Database(tmpDb);
        const row = check
          .query("SELECT COUNT(*) AS count FROM mcp_cache WHERE server_url = ?")
          .get(serverUrl) as { count: number };
        expect(row.count).toBe(0);
        check.close();
      } finally {
        Bun.spawnSync(["rm", "-f", tmpDb]);
      }
    });

    test("persistent cache is isolated per cacheDbPath", async () => {
      if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
      const tmpA = `${Bun.env.HOME}/.cache/kimi-toolchain/mcp-cache-test-a.db`;
      const tmpB = `${Bun.env.HOME}/.cache/kimi-toolchain/mcp-cache-test-b.db`;
      try {
        Bun.spawnSync(["rm", "-f", tmpA, tmpB]);
        const a = createHttpMcpClient({ url: BUN_DOCS_MCP_URL, cacheDbPath: tmpA });
        const b = createHttpMcpClient({ url: BUN_DOCS_MCP_URL, cacheDbPath: tmpB });
        a.clearCache();
        b.clearCache();
        // Populate A's cache; B must not see it.
        await a.callTool("search_bun", { query: "Bun.spawn" });
        const bHit = await b.callTool("search_bun", { query: "Bun.spawn" });
        expect(bHit.cached).toBe(false);
        // A's second call must hit its own cache.
        const aHit = await a.callTool("search_bun", { query: "Bun.spawn" });
        expect(aHit.cached).toBe(true);
      } finally {
        Bun.spawnSync(["rm", "-f", tmpA, tmpB]);
      }
    });
  });
});
