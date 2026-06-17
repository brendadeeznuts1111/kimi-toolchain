import { Effect } from "effect";
import {
  connectHerdrUnixSocket,
  resolveHerdrSocketPath,
  type HerdrUnixSocket,
} from "./herdr-unix-socket.ts";
import { herdrCliRun } from "./herdr-project-cli.ts";

export { resolveHerdrSocketPath };

export interface HerdrStreamEnvelope {
  event?: string;
  data?: Record<string, unknown>;
}

export interface HerdrEventSubscription {
  type: string;
  pane_id?: string;
  agent_status?: string;
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
}

/** Long-lived events.subscribe stream (connection stays open after ack). */
export function herdrSocketSubscribe(options: HerdrSocketSubscribeOptions): HerdrUnixSocket {
  const socketPath = resolveHerdrSocketPath(options.session);
  const payload =
    JSON.stringify({
      id: "kimi:events.subscribe",
      method: "events.subscribe",
      params: { subscriptions: options.subscriptions },
    }) + "\n";

  const socket = connectHerdrUnixSocket(socketPath);
  let buffer = "";
  let acked = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      options.onError?.(`invalid stream JSON: ${trimmed.slice(0, 120)}`);
      return;
    }

    if (!acked) {
      acked = true;
      const result = json.result as { type?: string } | undefined;
      if (json.error || result?.type !== "subscription_started") {
        options.onError?.(
          (json.error as { message?: string } | undefined)?.message || "subscription failed"
        );
        socket.end();
      }
      return;
    }

    if (json.event && typeof json.event === "string") {
      options.onEvent({
        event: json.event,
        data: (json.data as Record<string, unknown> | undefined) ?? undefined,
      });
      return;
    }

    if (typeof json.event === "string" || typeof json.data === "object") {
      const data = json.data as Record<string, unknown> | undefined;
      const event =
        typeof json.event === "string"
          ? json.event
          : typeof data?.type === "string"
            ? String(data.type)
            : undefined;
      if (event) options.onEvent({ event, data });
    }
  };

  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf("\n");
    }
  });

  socket.on("error", (error) => {
    options.onError?.(error instanceof Error ? error.message : String(error));
  });

  if (options.signal) {
    const onAbort = () => socket.end();
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  socket.write(payload);
  return socket;
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
