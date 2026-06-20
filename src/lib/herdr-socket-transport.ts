/**
 * Herdr socket transport selection — JSONL over Bun.connect vs ws+unix:// WebSocket.
 */

import { pathExists } from "./bun-io.ts";
import {
  connectHerdrUnixSocket,
  resolveHerdrSocketPath,
  type HerdrUnixSocket,
} from "./herdr-unix-socket.ts";
import { connectHerdrWebSocket, resolveHerdrWsUnixUrl } from "./herdr-ws-unix.ts";

export type HerdrSocketTransport = "jsonl" | "websocket";

export type ActiveHerdrSocketTransport = HerdrSocketTransport | "websocket-fallback";

export interface HerdrSocketConnectOptions {
  /** Override HERDR_SOCKET_TRANSPORT (jsonl | websocket | auto). */
  transport?: string;
  /** WebSocket request path on the unix socket (default /). */
  requestPath?: string;
  /** Invoked once the active transport is known (including fallback). */
  onTransport?: (transport: ActiveHerdrSocketTransport) => void;
  /** Connect timeout for websocket auto-fallback (default 1500ms). */
  connectTimeoutMs?: number;
}

const CONNECT_TIMEOUT_MS = 1_500;

type SocketEvent = "data" | "error" | "end" | "close" | "open";
type SocketListener = (...args: unknown[]) => void;

/** Read HERDR_SOCKET_TRANSPORT: jsonl (default), websocket, or auto. */
export function resolveHerdrSocketTransport(): "jsonl" | "websocket" | "auto" {
  const raw = (Bun.env.HERDR_SOCKET_TRANSPORT || "jsonl").trim().toLowerCase();
  if (raw === "websocket" || raw === "ws") return "websocket";
  if (raw === "auto") return "auto";
  return "jsonl";
}

export function describeHerdrSocketTransport(transport: ActiveHerdrSocketTransport): string {
  if (transport === "websocket-fallback") return "jsonl (websocket unavailable)";
  if (transport === "websocket") return "ws+unix";
  return "jsonl";
}

export type HerdrSocketTransportProbe = {
  transport: string;
  wsSupported: boolean;
  socketPath: string;
};

export type HerdrSocketHealthProbe = {
  socketPath: string;
  socketFileExists: boolean;
  connectable: boolean;
  connectErrorCode?: string;
  connectErrorMessage?: string;
};

const SOCKET_CONNECT_PROBE_MS = 800;

/** Parse Bun.connect unix socket error messages (exported for tests and doctor probes). */
export function parseSocketConnectErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const message = error instanceof Error ? error.message : Bun.inspect(error);
  const match = message.match(/\b(EADDRINUSE|ENOENT|ECONNREFUSED|ETIMEDOUT|EAGAIN)\b/);
  if (match?.[1]) return match[1];
  if (/Resource temporarily unavailable|os error 35/i.test(message)) return "EAGAIN";
  if (/os error 61|Connection refused/i.test(message)) return "ECONNREFUSED";
  return undefined;
}

function socketErrorCode(error: unknown): string | undefined {
  return parseSocketConnectErrorCode(error);
}

function socketErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : Bun.inspect(error);
}

/** Quick Bun.connect probe — resolves when open fires or connectError/timeout. */
export async function probeSocketConnectable(
  socketPath: string,
  timeoutMs = SOCKET_CONNECT_PROBE_MS
): Promise<
  Pick<HerdrSocketHealthProbe, "connectable" | "connectErrorCode" | "connectErrorMessage">
> {
  let settled = false;
  let result: Pick<
    HerdrSocketHealthProbe,
    "connectable" | "connectErrorCode" | "connectErrorMessage"
  > = {
    connectable: false,
    connectErrorCode: "ETIMEDOUT",
    connectErrorMessage: `connect probe timed out after ${timeoutMs}ms`,
  };

  const finish = (
    next: Pick<HerdrSocketHealthProbe, "connectable" | "connectErrorCode" | "connectErrorMessage">
  ) => {
    if (settled) return;
    settled = true;
    result = next;
  };

  void Bun.connect({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.end();
        finish({ connectable: true });
      },
      connectError(_socket, error) {
        finish({
          connectable: false,
          connectErrorCode: socketErrorCode(error),
          connectErrorMessage: socketErrorMessage(error),
        });
      },
      error(_socket, error) {
        finish({
          connectable: false,
          connectErrorCode: socketErrorCode(error),
          connectErrorMessage: socketErrorMessage(error),
        });
      },
      data() {},
      close() {},
      end() {},
    },
  });

  const deadline = Date.now() + timeoutMs;
  while (!settled && Date.now() < deadline) {
    await Bun.sleep(25);
  }

  return result;
}

/** Doctor probe: socket path, on-disk file, and live connectability. */
export async function probeHerdrSocketHealth(socketPath?: string): Promise<HerdrSocketHealthProbe> {
  const path = socketPath ?? resolveHerdrSocketPath();
  const socketFileExists = pathExists(path);
  if (!socketFileExists) {
    return { socketPath: path, socketFileExists, connectable: false };
  }
  const connect = await probeSocketConnectable(path);
  return { socketPath: path, socketFileExists, ...connect };
}

/** Doctor probe: env transport mode, ws+unix URL support, resolved socket path. */
export function probeHerdrSocketTransport(socketPath?: string): HerdrSocketTransportProbe {
  const path = socketPath ?? resolveHerdrSocketPath();
  const transport = resolveHerdrSocketTransport();
  let wsSupported = typeof WebSocket !== "undefined";
  if (wsSupported) {
    try {
      const url = resolveHerdrWsUnixUrl(path);
      wsSupported = url.startsWith("ws+unix://") || url.startsWith("wss+unix://");
    } catch {
      wsSupported = false;
    }
  }
  return { transport, wsSupported, socketPath: path };
}

function attachTransportTag(
  socket: HerdrUnixSocket,
  transport: ActiveHerdrSocketTransport
): HerdrUnixSocket & { transport: ActiveHerdrSocketTransport } {
  return Object.assign(socket, { transport });
}

function connectJsonl(path: string, onTransport?: HerdrSocketConnectOptions["onTransport"]) {
  onTransport?.("jsonl");
  return attachTransportTag(connectHerdrUnixSocket(path), "jsonl");
}

function connectWebsocket(
  path: string,
  requestPath: string | undefined,
  onTransport?: HerdrSocketConnectOptions["onTransport"]
) {
  onTransport?.("websocket");
  return connectHerdrWebSocket(path, requestPath);
}

function bindSocketEvents(socket: HerdrUnixSocket, listeners: Map<SocketEvent, SocketListener[]>) {
  const relay =
    (event: SocketEvent) =>
    (...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    };
  socket.on("data", relay("data") as (chunk: string) => void);
  socket.on("error", relay("error") as (error: unknown) => void);
  socket.on("end", relay("end") as () => void);
  socket.on("close", relay("close") as () => void);
}

/**
 * Connect to Herdr using the configured transport.
 * `auto` tries ws+unix first and falls back to JSONL when the upgrade fails.
 */
export function connectHerdrSocket(
  path: string,
  options: HerdrSocketConnectOptions = {}
): HerdrUnixSocket & { transport: ActiveHerdrSocketTransport } {
  const mode = (options.transport?.trim().toLowerCase() || resolveHerdrSocketTransport()) as
    | "jsonl"
    | "websocket"
    | "auto"
    | "ws";

  if (mode === "jsonl") return connectJsonl(path, options.onTransport);
  if (mode === "websocket" || mode === "ws") {
    return connectWebsocket(path, options.requestPath, options.onTransport);
  }

  const timeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const listeners = new Map<SocketEvent, SocketListener[]>();
  const pendingWrites: (string | Uint8Array)[] = [];
  let active: HerdrUnixSocket & { transport: ActiveHerdrSocketTransport };
  let switched = false;
  let gotData = false;
  let settled = false;

  const flushPendingWrites = () => {
    if (!settled) return;
    for (const chunk of pendingWrites) active.write(chunk);
    pendingWrites.length = 0;
  };

  const settleTransport = (transport: ActiveHerdrSocketTransport) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.onTransport?.(transport);
    flushPendingWrites();
  };

  const switchToJsonl = () => {
    if (switched) return;
    switched = true;
    settled = false;
    active.removeAllListeners();
    active.close();
    active = attachTransportTag(connectHerdrUnixSocket(path), "websocket-fallback");
    bindSocketEvents(active, listeners);
    settleTransport("websocket-fallback");
  };

  active = connectWebsocket(path, options.requestPath);
  bindSocketEvents(active, listeners);

  active.on("data", () => {
    gotData = true;
    settleTransport("websocket");
  });
  active.on("error", () => {
    if (!gotData) switchToJsonl();
  });

  const timer = setTimeout(() => {
    if (!gotData && !switched) switchToJsonl();
  }, timeoutMs);
  active.on("close", () => {
    clearTimeout(timer);
    if (!gotData && !switched) switchToJsonl();
  });

  const proxy: HerdrUnixSocket & { transport: ActiveHerdrSocketTransport } = {
    get transport() {
      return active.transport;
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener as SocketListener);
      listeners.set(event, list);
    },
    write(data) {
      if (settled) active.write(data);
      else pendingWrites.push(data);
    },
    end() {
      active.end();
    },
    close() {
      active.close();
    },
    removeAllListeners() {
      listeners.clear();
      active.removeAllListeners();
    },
  };

  return proxy;
}

/** Format an outbound Herdr RPC payload for the active transport. */
export function formatHerdrSocketPayload(
  payload: Record<string, unknown>,
  transport: HerdrSocketTransport
): string {
  const json = JSON.stringify(payload);
  return transport === "jsonl" ? `${json}\n` : json;
}
