/**
 * bun-docs dashboard handler — probe + search API regression guard.
 *
 * @see examples/dashboard/src/handlers/bun-docs.ts
 */
import { describe, expect, test } from "bun:test";
import { apiBunDocs, apiBunDocsSearch, apiBunDocsWebview } from "../bun-docs.ts";

describe("bun-docs", () => {
  test("GET /api/bun-docs returns probe metadata", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    const res = await apiBunDocs();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server).toBe("bun-docs");
    expect(body.toolCount).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.stability?.stable).toBe(true);
  });

  test("POST /api/bun-docs/search requires query", async () => {
    const res = await apiBunDocsSearch(
      new Request("http://127.0.0.1/api/bun-docs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  test("POST /api/bun-docs/search returns formatted text", async () => {
    if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
    const res = await apiBunDocsSearch(
      new Request("http://127.0.0.1/api/bun-docs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Bun.escapeHTML", tool: "search_bun" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
  });

  test("POST /api/bun-docs/webview requires query", async () => {
    const res = await apiBunDocsWebview(
      new Request("http://127.0.0.1/api/bun-docs/webview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.taxonomyId).toBe("dashboard_missing_query");
  });

  test("POST /api/bun-docs/webview rejects invalid tool", async () => {
    const res = await apiBunDocsWebview(
      new Request("http://127.0.0.1/api/bun-docs/webview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Bun.spawn", tool: "invalid_tool" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.taxonomyId).toBe("dashboard_invalid_tool");
  });
});
