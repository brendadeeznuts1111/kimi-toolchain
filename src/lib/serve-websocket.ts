/**
 * Bun.serve WebSocket upgrade — topic subscriptions for subscriberCount metrics.
 *
 * @see https://bun.com/docs/runtime/http/metrics#server-subscribercount-topic
 */

import {
  isServeWsTopic,
  SERVE_WS_TOPICS,
  subscriberCountsForTopics,
  type ServeMetricsSource,
  type ServeWsTopic,
} from "./serve-metrics.ts";

export const DASHBOARD_WS_PATH = "/api/ws";

export interface DashboardWsData {
  topic: ServeWsTopic;
}

export function resolveWsTopicFromUrl(url: URL): ServeWsTopic {
  const raw = url.searchParams.get("topic")?.trim() ?? "dashboard";
  return isServeWsTopic(raw) ? raw : "dashboard";
}

export function wantsWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/** JSON probe for topic subscriber counts (non-upgrade GET). */
export function buildWsTopicsJson(server: ServeMetricsSource): Record<string, unknown> {
  return {
    ok: true,
    path: DASHBOARD_WS_PATH,
    topics: [...SERVE_WS_TOPICS],
    subscribers: subscriberCountsForTopics(server),
    pendingWebSockets: server.pendingWebSockets,
    upgrade: `WebSocket upgrade to ${DASHBOARD_WS_PATH}?topic=<dashboard|agents|chat>`,
    note: "server.subscriberCount(topic) increments after ws.subscribe in the open handler.",
  };
}

/**
 * Handle `/api/ws` — upgrade when requested, otherwise return subscriber snapshot.
 * Returns undefined when not the WS path (caller continues routing).
 */
export function handleDashboardWebSocketRequest(
  req: Request,
  server: ServeMetricsSource & {
    upgrade(req: Request, options?: { data?: DashboardWsData }): boolean;
  }
): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname !== DASHBOARD_WS_PATH) return undefined;

  if (wantsWebSocketUpgrade(req)) {
    const topic = resolveWsTopicFromUrl(url);
    const upgraded = server.upgrade(req, { data: { topic } });
    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 426 });
    }
    return undefined;
  }

  return new Response(JSON.stringify(buildWsTopicsJson(server), null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const dashboardWebSocketHandlers = {
  open(ws: { data?: DashboardWsData; subscribe(topic: string): void }) {
    const topic = ws.data?.topic ?? "dashboard";
    if (isServeWsTopic(topic)) ws.subscribe(topic);
  },
  message() {
    // metrics demo — subscriptions happen on open
  },
  close(ws: { data?: DashboardWsData; unsubscribe(topic: string): void }) {
    const topic = ws.data?.topic;
    if (topic && isServeWsTopic(topic)) ws.unsubscribe(topic);
  },
} satisfies Bun.WebSocketHandler<DashboardWsData>;
