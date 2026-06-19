/**
 * Herdr IPC over Bun WebSocket client — ws+unix:// / wss+unix:// (Bun v1.3.13+).
 * See https://bun.com/blog/bun-v1.3.13#websocket-client-support-ws-unix-and-wss-unix
 */

import type { HerdrUnixSocket } from "./herdr-unix-socket.ts";

/** Build a ws+unix URL matching the npm `ws` package path split convention. */
export function resolveHerdrWsUnixUrl(socketPath: string, requestPath = "/"): string {
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const tls = Bun.env.HERDR_SOCKET_TLS === "1";
  const scheme = tls ? "wss+unix" : "ws+unix";
  return `${scheme}://${socketPath}:${path}`;
}

type HerdrSocketListener = (...args: unknown[]) => void;

/** EventEmitter-shaped WebSocket client for Herdr JSON-RPC (one JSON object per frame). */
export function connectHerdrWebSocket(
  socketPath: string,
  requestPath = "/"
): HerdrUnixSocket & { transport: "websocket" } {
  const url = resolveHerdrWsUnixUrl(socketPath, requestPath);
  const ws = new WebSocket(url);
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
