import { describe, expect, test } from "bun:test";
import { SERVE_WS_TOPICS } from "../src/lib/serve-metrics.ts";
import {
  buildWsTopicsJson,
  dashboardWebSocketHandlers,
  DASHBOARD_WS_PATH,
  handleDashboardWebSocketRequest,
  resolveWsTopicFromUrl,
} from "../src/lib/serve-websocket.ts";

describe("serve-websocket", () => {
  test("resolveWsTopicFromUrl defaults and validates topics", () => {
    expect(resolveWsTopicFromUrl(new URL("http://x/api/ws"))).toBe("dashboard");
    expect(resolveWsTopicFromUrl(new URL("http://x/api/ws?topic=agents"))).toBe("agents");
    expect(resolveWsTopicFromUrl(new URL("http://x/api/ws?topic=unknown"))).toBe("dashboard");
  });

  test("GET /api/ws returns subscriber snapshot without upgrade", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        return handleDashboardWebSocketRequest(req, srv) ?? new Response("nf", { status: 404 });
      },
      websocket: dashboardWebSocketHandlers,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${DASHBOARD_WS_PATH}`);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.topics).toEqual([...SERVE_WS_TOPICS]);
      expect(body.subscribers).toEqual({ dashboard: 0, agents: 0, chat: 0 });
    } finally {
      server.stop(true);
    }
  });

  test("WebSocket upgrade subscribes topic and updates subscriberCount", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        const handled = handleDashboardWebSocketRequest(req, srv);
        if (handled !== undefined) return handled;
        return new Response("nf", { status: 404 });
      },
      websocket: dashboardWebSocketHandlers,
    });

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}${DASHBOARD_WS_PATH}?topic=agents`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("ws failed"));
        setTimeout(() => reject(new Error("ws timeout")), 2000);
      });

      expect(server.subscriberCount("agents")).toBe(1);
      expect(buildWsTopicsJson(server).subscribers).toEqual({
        dashboard: 0,
        agents: 1,
        chat: 0,
      });

      ws.close();
      await Bun.sleep(20);
      expect(server.subscriberCount("agents")).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});
