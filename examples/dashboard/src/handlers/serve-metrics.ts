/**
 * GET /api/serve-metrics — Bun.serve pendingRequests / pendingWebSockets / subscriberCount.
 *
 * @see https://bun.com/docs/runtime/http/metrics#server-pendingrequests-and-server-pendingwebsockets
 * @see https://bun.com/docs/runtime/http/metrics#server-subscribercount-topic
 */

import { readRegisteredServeMetrics, SERVE_WS_TOPICS } from "../../../../src/lib/serve-metrics.ts";
import { DASHBOARD_WS_PATH } from "../../../../src/lib/serve-websocket.ts";
import { jsonResponse } from "./shared.ts";

export async function apiServeMetrics(): Promise<Response> {
  const metrics = readRegisteredServeMetrics(SERVE_WS_TOPICS);
  if (!metrics) {
    return jsonResponse(
      {
        ok: false,
        error: "Dashboard server metrics unavailable (not registered)",
        note: "registerServeMetricsSource() must run after Bun.serve in index.ts",
      },
      503
    );
  }

  return jsonResponse({
    ok: true,
    pendingRequests: metrics.pendingRequests,
    pendingWebSockets: metrics.pendingWebSockets,
    subscribers: metrics.subscribers,
    protocol: metrics.protocol,
    port: metrics.port,
    fetchedAt: metrics.fetchedAt,
    metrics,
    websocket: {
      path: DASHBOARD_WS_PATH,
      topics: [...SERVE_WS_TOPICS],
      upgrade: `ws://<host>:<port>${DASHBOARD_WS_PATH}?topic=dashboard`,
    },
    note: "subscribers uses server.subscriberCount(topic) — connect a WebSocket to /api/ws to increment.",
  });
}
