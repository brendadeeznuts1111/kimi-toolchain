import { Effect } from "effect";
import {
  createJsonlLineBuffer,
  handleHerdrSubscribeFrame,
  parseHerdrSocketJsonLine,
  type HerdrEventSubscription,
  type HerdrStreamEnvelope,
} from "./herdr-socket-protocol.ts";
import {
  connectHerdrSocket,
  formatHerdrSocketPayload,
  resolveHerdrSocketTransport,
  type ActiveHerdrSocketTransport,
} from "./herdr-socket-transport.ts";
import { resolveHerdrSocketPath, type HerdrUnixSocket } from "./herdr-unix-socket.ts";
import { herdrCliRun } from "./herdr-project-cli.ts";

export { resolveHerdrSocketPath };
export type { HerdrEventSubscription, HerdrStreamEnvelope };
export { resolveHerdrSocketTransport, type ActiveHerdrSocketTransport };

function resolveReconnectDelaysMs(): readonly number[] {
  const testDelays = Bun.env.HERDR_SOCKET_TEST_RECONNECT_MS?.split(",").map((v) =>
    Number(v.trim())
  );
  if (testDelays?.length && testDelays.every((n) => Number.isFinite(n) && n >= 0)) {
    return testDelays;
  }
  return [1_000, 2_000, 4_000, 8_000, 16_000];
}

/** Report custom pane metadata via Herdr CLI (triggers pane.agent_status_changed). */
export function herdrReportPaneMetadata(options: {
  paneId: string;
  source: string;
  customStatus?: string;
  stateLabels?: Record<string, string>;
  ttlMs?: number;
  session?: string;
}): void {
  const args = ["pane", "report-metadata", options.paneId, "--source", options.source];
  if (options.customStatus) args.push("--custom-status", options.customStatus);
  if (options.stateLabels) {
    for (const [status, text] of Object.entries(options.stateLabels)) {
      args.push("--state-label", `${status}=${text}`);
    }
  }
  if (options.ttlMs != null) args.push("--ttl-ms", String(options.ttlMs));
  herdrCliRun(options.session, args);
}

export interface HerdrSocketSubscribeOptions {
  subscriptions: HerdrEventSubscription[];
  onEvent: (envelope: HerdrStreamEnvelope) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
  /** Herdr session name; primary when omitted, empty, or "default". */
  session?: string;
  /** Override HERDR_SOCKET_TRANSPORT for this subscription. */
  transport?: string;
  /** Invoked once the active transport is selected (including auto-fallback). */
  onTransport?: (transport: ActiveHerdrSocketTransport) => void;
}

type SocketEvent = "data" | "error" | "end" | "close" | "open";
type SocketListener = (...args: unknown[]) => void;

/** Long-lived events.subscribe stream (connection stays open after ack). */
export function herdrSocketSubscribe(
  options: HerdrSocketSubscribeOptions
): HerdrUnixSocket & { transport?: ActiveHerdrSocketTransport } {
  const socketPath = resolveHerdrSocketPath(options.session);
  const wireTransport =
    options.transport?.trim().toLowerCase() === "websocket" ||
    options.transport?.trim().toLowerCase() === "ws" ||
    resolveHerdrSocketTransport() === "websocket"
      ? "websocket"
      : "jsonl";

  const payload = formatHerdrSocketPayload(
    {
      id: "kimi:events.subscribe",
      method: "events.subscribe",
      params: { subscriptions: options.subscriptions },
    },
    wireTransport
  );

  let activeSocket: (HerdrUnixSocket & { transport?: ActiveHerdrSocketTransport }) | null = null;
  let shuttingDown = false;
  let reconnectScheduled = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const subscribeState = { acked: false };
  const proxyListeners = new Map<SocketEvent, SocketListener[]>();

  const emitProxy = (event: SocketEvent, ...args: unknown[]) => {
    for (const listener of proxyListeners.get(event) ?? []) listener(...args);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const detachActiveSocket = () => {
    activeSocket?.removeAllListeners();
    activeSocket?.close();
    activeSocket = null;
  };

  const onFrame = (line: string) => {
    const json = parseHerdrSocketJsonLine(line);
    if (!json) {
      options.onError?.(`invalid stream JSON: ${line.slice(0, 120)}`);
      return;
    }
    const outcome = handleHerdrSubscribeFrame(
      json,
      subscribeState,
      options.onEvent,
      options.onError
    );
    if (outcome === "subscription_failed") {
      shuttingDown = true;
      clearReconnectTimer();
      activeSocket?.end();
      return;
    }
    if (outcome === "subscription_ok") {
      reconnectScheduled = false;
    }
    if (outcome === "event") {
      reconnectAttempt = 0;
      reconnectScheduled = false;
    }
  };

  const scheduleReconnect = (reason: string) => {
    if (shuttingDown || options.signal?.aborted || reconnectScheduled) return;
    const reconnectDelays = resolveReconnectDelaysMs();
    if (reconnectAttempt >= reconnectDelays.length) {
      shuttingDown = true;
      detachActiveSocket();
      options.onError?.(
        reconnectAttempt > 0
          ? `socket reconnect failed after ${reconnectDelays.length} attempts: ${reason}`
          : reason
      );
      emitProxy("close");
      return;
    }

    reconnectScheduled = true;
    const delay = reconnectDelays[reconnectAttempt]!;
    reconnectAttempt += 1;

    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectScheduled = false;
      reconnectTimer = null;
      if (shuttingDown || options.signal?.aborted) return;
      subscribeState.acked = false;
      detachActiveSocket();
      connectAndBind();
    }, delay);
  };

  const connectAndBind = () => {
    const socket = connectHerdrSocket(socketPath, {
      transport: options.transport,
      onTransport: options.onTransport,
    });
    activeSocket = socket;

    const pushChunk =
      socket.transport === "jsonl" || socket.transport === "websocket-fallback"
        ? createJsonlLineBuffer(onFrame)
        : onFrame;

    socket.on("data", (chunk) => {
      pushChunk(chunk);
      emitProxy("data", chunk);
    });

    socket.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (shuttingDown) {
        emitProxy("error", error);
        return;
      }
      if (options.signal?.aborted) return;
      scheduleReconnect(message);
    });

    socket.on("end", () => {
      if (shuttingDown) {
        emitProxy("end");
        return;
      }
      if (options.signal?.aborted) return;
      scheduleReconnect("socket ended unexpectedly");
    });

    socket.on("close", () => {
      if (shuttingDown) {
        emitProxy("close");
        return;
      }
      if (options.signal?.aborted) return;
      scheduleReconnect("socket closed unexpectedly");
    });

    socket.write(payload);
  };

  if (options.signal) {
    const onAbort = () => {
      shuttingDown = true;
      clearReconnectTimer();
      activeSocket?.end();
    };
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  connectAndBind();

  const proxy: HerdrUnixSocket & { transport?: ActiveHerdrSocketTransport } = {
    get transport() {
      return activeSocket?.transport;
    },
    on(event, listener) {
      const list = proxyListeners.get(event) ?? [];
      list.push(listener as SocketListener);
      proxyListeners.set(event, list);
    },
    write(data) {
      activeSocket?.write(data);
    },
    end() {
      shuttingDown = true;
      clearReconnectTimer();
      activeSocket?.end();
    },
    close() {
      shuttingDown = true;
      clearReconnectTimer();
      activeSocket?.close();
    },
    removeAllListeners() {
      proxyListeners.clear();
      activeSocket?.removeAllListeners();
    },
  };

  return proxy;
}

// ── Effect wrappers ─────────────────────────────────────────────────────

/** Effect wrapper for herdrReportPaneMetadata (fire-and-forget). */
export function reportPaneMetadataEffect(options: {
  paneId: string;
  source: string;
  customStatus?: string;
  stateLabels?: Record<string, string>;
  ttlMs?: number;
  session?: string;
}): Effect.Effect<void, never> {
  return Effect.sync(() => {
    herdrReportPaneMetadata(options);
  });
}
