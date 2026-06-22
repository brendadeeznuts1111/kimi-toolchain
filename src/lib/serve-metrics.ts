/**
 * Bun.serve built-in metrics — pendingRequests, pendingWebSockets, subscriberCount.
 *
 * @see https://bun.com/docs/runtime/http/metrics#server-pendingrequests-and-server-pendingwebsockets
 * @see https://bun.com/docs/runtime/http/metrics#server-subscribercount-topic
 */

/** @see https://bun.com/docs/runtime/http/metrics#server-pendingrequests-and-server-pendingwebsockets */
export const BUN_SERVE_METRICS_DOC_URL =
  "https://bun.com/docs/runtime/http/metrics#server-pendingrequests-and-server-pendingwebsockets";

/** @see https://bun.com/docs/runtime/http/metrics#server-subscribercount-topic */
export const BUN_SERVE_SUBSCRIBER_COUNT_DOC_URL =
  "https://bun.com/docs/runtime/http/metrics#server-subscribercount-topic";

/** WebSocket pub/sub topics used by examples dashboard `/api/ws`. */
export const SERVE_WS_TOPICS = ["dashboard", "agents", "chat"] as const;

export type ServeWsTopic = (typeof SERVE_WS_TOPICS)[number];

export function isServeWsTopic(topic: string): topic is ServeWsTopic {
  return (SERVE_WS_TOPICS as readonly string[]).includes(topic);
}

export function subscriberCountsForTopics(
  server: ServeMetricsSource,
  topics: readonly string[] = SERVE_WS_TOPICS
): Record<string, number> | null {
  if (typeof server.subscriberCount !== "function") return null;
  return Object.fromEntries(topics.map((topic) => [topic, server.subscriberCount!(topic)]));
}

/** Minimal Bun.serve instance surface for metrics reads. */
export interface ServeMetricsSource {
  pendingRequests: number;
  pendingWebSockets: number;
  protocol?: string | null;
  port?: number | null;
  hostname?: string;
  url?: string | URL;
  development?: boolean;
  subscriberCount?: (topic: string) => number;
}

export interface ServeMetricsSnapshot {
  pendingRequests: number;
  pendingWebSockets: number;
  protocol: string | null;
  port: number | null;
  hostname: string | null;
  url: string | null;
  development: boolean | null;
  subscribers: Record<string, number> | null;
  fetchedAt: string;
}

let registeredServe: ServeMetricsSource | null = null;

/** Register the active Bun.serve instance (examples dashboard, probes, etc.). */
export function registerServeMetricsSource(server: ServeMetricsSource): void {
  registeredServe = server;
}

export function getRegisteredServeMetricsSource(): ServeMetricsSource | null {
  return registeredServe;
}

export function clearRegisteredServeMetricsSource(): void {
  registeredServe = null;
}

export function snapshotServeMetrics(
  server: ServeMetricsSource,
  topics: readonly string[] = []
): ServeMetricsSnapshot {
  const subscribers = topics.length > 0 ? subscriberCountsForTopics(server, topics) : null;

  const url =
    server.url === undefined ? null : typeof server.url === "string" ? server.url : server.url.href;

  return {
    pendingRequests: server.pendingRequests,
    pendingWebSockets: server.pendingWebSockets,
    protocol: server.protocol ?? null,
    port: server.port ?? null,
    hostname: server.hostname ?? null,
    url,
    development: server.development ?? null,
    subscribers,
    fetchedAt: new Date().toISOString(),
  };
}

export function readRegisteredServeMetrics(
  topics: readonly string[] = []
): ServeMetricsSnapshot | null {
  const server = registeredServe;
  if (!server) return null;
  return snapshotServeMetrics(server, topics);
}
