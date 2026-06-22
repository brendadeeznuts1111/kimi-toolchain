/**
 * Bun Docs dashboard card — interactive MCP search widget.
 */

import { loadMCPClient } from "../../lib/mcp/sse.ts";

const DEFAULT_TOOL = "search_bun";

function selectTool(tools: Array<{ name: string; description: string }>): string {
  const preferred = ["search_bun", "query_docs_filesystem_bun"];
  for (const name of preferred) {
    if (tools.some((t) => t.name === name)) return name;
  }
  return tools[0]?.name ?? DEFAULT_TOOL;
}

export async function renderBunDocsCard(query?: string): Promise<Response> {
  if (!query) {
    return new Response(
      `
      <div id="bun-docs-card">
        <h3>Bun Knowledge</h3>
        <input type="text" id="bun-query" placeholder="Ask about Bun APIs..." />
        <button onclick="askBun()">Search</button>
        <pre id="bun-result"></pre>
        <script>
          async function askBun() {
            const q = document.getElementById('bun-query').value;
            const res = await fetch('/api/bun-docs?query=' + encodeURIComponent(q));
            const data = await res.text();
            document.getElementById('bun-result').textContent = data;
          }
        </script>
      </div>
    `,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const client = await loadMCPClient("bun-docs");
  const tools = await client.listTools();
  const result = await client.callTool(selectTool(tools), { query });

  return new Response(String(result), {
    headers: { "Content-Type": "text/plain" },
  });
}
