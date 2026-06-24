/**
 * Herdr IPC over Bun WebSocket client — ws+unix:// / wss+unix:// (Bun v1.3.13+).
 * Remote wss:// clients honor HTTP(S)_PROXY when set (Bun v1.3.6+).
 * @see https://bun.com/blog/bun-v1.3.13#websocket-client-support-ws-unix-and-wss-unix
 * @see {@link BUN_WEBSOCKET_PROXY_RELEASE_URL}
 */

import { BUN_WEBSOCKET_PROXY_RELEASE_URL } from "./bun-utils.ts";
import { shouldBypassProxy } from "./network-config.ts";

/** @see {@link BUN_WEBSOCKET_PROXY_RELEASE_URL} */
export { BUN_WEBSOCKET_PROXY_RELEASE_URL };
import type { HerdrUnixSocket } from "./herdr-unix-socket.ts";

/** Build a ws+unix URL matching the npm `ws` package path split convention. */
export function resolveHerdrWsUnixUrl(socketPath: string, requestPath = "/"): string {
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const tls = Bun.env.HERDR_SOCKET_TLS === "1";
  const scheme = tls ? "wss+unix" : "ws+unix";
  return `${scheme}://${socketPath}:${path}`;
}

/** True for Bun unix-socket WebSocket schemes (proxy must not apply). */
export function isUnixWebSocketUrl(url: string): boolean {
  return /^wss?\+unix:\/\//i.test(url);
}

/**
 * Resolve HTTP(S) proxy for remote WebSocket URLs when HTTP_PROXY / HTTPS_PROXY is set.
 * Returns undefined for ws+unix:// URLs and hosts covered by NO_PROXY.
 */
export function resolveWebSocketProxy(
  url: string,
  env: Record<string, string | undefined> = Bun.env
): string | undefined {
  if (isUnixWebSocketUrl(url)) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (shouldBypassProxy(parsed.hostname, env)) return undefined;

  const secure = parsed.protocol === "wss:";
  const proxy = secure
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy;

  const trimmed = proxy?.trim();
  return trimmed || undefined;
}

type HerdrSocketListener = (...args: unknown[]) => void;

function createHerdrWebSocketClient(
  ws: WebSocket,
  url: string
): HerdrUnixSocket & { transport: "websocket" } {
  const listeners = new Map<string, HerdrSocketListener[]>();
  const writeQueue: string[] = [];
  let opened = false;
  let settled = false;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };

  const flushWrites = () => {
    if (!opened || ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of writeQueue) ws.send(chunk);
    writeQueue.length = 0;
  };

  const normalizeOutbound = (data: string | Uint8Array): string => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    return text.endsWith("\n") ? text.slice(0, -1) : text;
  };

  ws.addEventListener("open", () => {
    opened = true;
    flushWrites();
    emit("open");
  });

  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
    emit("data", text);
  });

  ws.addEventListener("error", () => {
    if (settled) return;
    emit("error", new Error(`WebSocket error (${url})`));
  });

  ws.addEventListener("close", () => {
    settled = true;
    emit("end");
    emit("close");
  });

  return {
    transport: "websocket",
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener as HerdrSocketListener);
      listeners.set(event, list);
    },
    write(data) {
      const payload = normalizeOutbound(data);
      if (opened && ws.readyState === WebSocket.OPEN) ws.send(payload);
      else writeQueue.push(payload);
    },
    end() {
      ws.close();
    },
    close() {
      ws.close();
    },
    removeAllListeners() {
      listeners.clear();
    },
  };
}

/** Connect to a remote ws:// or wss:// endpoint (proxy-aware). */
export function connectHerdrRemoteWebSocket(
  url: string,
  env: Record<string, string | undefined> = Bun.env
): HerdrUnixSocket & { transport: "websocket" } {
  const proxy = resolveWebSocketProxy(url, env);
  const ws = proxy ? new WebSocket(url, { proxy }) : new WebSocket(url);
  return createHerdrWebSocketClient(ws, url);
}

/** EventEmitter-shaped WebSocket client for Herdr JSON-RPC (one JSON object per frame). */
export function connectHerdrWebSocket(
  socketPath: string,
  requestPath = "/"
): HerdrUnixSocket & { transport: "websocket" } {
  const url = resolveHerdrWsUnixUrl(socketPath, requestPath);
  const ws = new WebSocket(url);
  return createHerdrWebSocketClient(ws, url);
}
