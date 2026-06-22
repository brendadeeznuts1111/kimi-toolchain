import { describe, expect, test } from "bun:test";
import {
  buildBunDocsKnowledgeCard,
  checkToolStability,
  clearBunDocsMcpCache,
  EXPECTED_BUN_DOCS_TOOLS,
  formatBunDocsContent,
  probeBunDocs,
  searchBunDocs,
} from "../src/lib/bun-docs-mcp.ts";
import { clearProbeCache } from "../src/lib/mcp-probe.ts";
import { BUN_DOCS_MCP_TOOLS } from "../src/lib/mcp-registry.ts";

describe("bun-docs-mcp", () => {
  test("checkToolStability detects missing and unexpected tools", () => {
    const stable = checkToolStability([...BUN_DOCS_MCP_TOOLS]);
    expect(stable.stable).toBe(true);
    expect(stable.missing).toEqual([]);
    expect(stable.expectedCount).toBe(EXPECTED_BUN_DOCS_TOOLS.length);

    const drift = checkToolStability(["search_bun", "extra_tool"]);
    expect(drift.stable).toBe(false);
    expect(drift.missing).toContain("query_docs_filesystem_bun");
    expect(drift.unexpected).toContain("extra_tool");
  });

  test("formatBunDocsContent extracts text from content blocks", () => {
    const text = formatBunDocsContent({
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    });
    expect(text).toBe("Hello\n\nWorld");
  });

  test("formatBunDocsContent passes through plain strings", () => {
    expect(formatBunDocsContent("plain text")).toBe("plain text");
  });

  test("probeBunDocs discovers live tools", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    clearProbeCache();
    clearBunDocsMcpCache();
    const result = await probeBunDocs(15000);
    expect(result.ok).toBe(true);
    expect(checkToolStability(result.tools ?? []).stable).toBe(true);
    expect(result.toolDescriptions?.length).toBeGreaterThan(0);
  });

  test("buildBunDocsKnowledgeCard returns stable card", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    clearProbeCache();
    clearBunDocsMcpCache();
    const card = await buildBunDocsKnowledgeCard(15000);
    expect(card.ok).toBe(true);
    expect(card.server).toBe("bun-docs");
    expect(card.toolCount).toBe(EXPECTED_BUN_DOCS_TOOLS.length);
    expect(card.stability.stable).toBe(true);
    expect(card.tools.length).toBeGreaterThan(0);
    expect(card.probedAt).toBeDefined();
  });

  test("searchBunDocs returns content for a query", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    clearBunDocsMcpCache();
    const result = await searchBunDocs("Bun.spawn", 30000);
    expect(result.ok).toBe(true);
    expect(result.content).toBeDefined();
  });
});
