/**
 * Unix domain socket client via Bun.connect — replaces node:net for Herdr IPC.
 * See https://bun.com/docs/runtime/networking/tcp
 */

import { join } from "path";
import { resolveHerdrSession } from "./herdr-project-cli.ts";
import { herdrConfigDir } from "./paths.ts";

/**
 * Unix socket for a Herdr server session.
 *
 * Primary/default → ~/.config/herdr/herdr.sock
 * Named session   → ~/.config/herdr/sessions/<name>/herdr.sock
 *
 * HERDR_SOCKET_PATH overrides only the primary session (matches CLI routing).
 */
export function resolveHerdrSocketPath(session?: string): string {
  const resolved = resolveHerdrSession(session);
  if (!resolved) {
    if (Bun.env.HERDR_SOCKET_PATH) return Bun.env.HERDR_SOCKET_PATH;
    return join(herdrConfigDir(), "herdr.sock");
  }
  return join(herdrConfigDir(), "sessions", resolved, "herdr.sock");
}

type HerdrSocketListener = (...args: unknown[]) => void;

export interface HerdrUnixSocket {
  write(data: string | Uint8Array): void;
  end(): void;
  close(): void;
  removeAllListeners(): void;
  on(event: "data", listener: (chunk: string) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  on(event: "end" | "close", listener: () => void): void;
}

/** Node-style EventEmitter surface over Bun.connect for Herdr JSONL sockets. */
export function connectHerdrUnixSocket(path: string): HerdrUnixSocket {
  const listeners = new Map<string, HerdrSocketListener[]>();
  let bunSocket: Bun.Socket | null = null;
  let opened = false;
  const writeQueue: (string | Uint8Array)[] = [];

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };

  const flushWrites = () => {
    if (!bunSocket || !opened) return;
    for (const chunk of writeQueue) bunSocket.write(chunk);
    writeQueue.length = 0;
  };

  void Bun.connect({
    unix: path,
    socket: {
      open(socket) {
        bunSocket = socket;
        opened = true;
        flushWrites();
      },
      data(_socket, data) {
        const text =
          typeof data === "string"
            ? data
            : data instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(data))
              : new TextDecoder().decode(data);
        emit("data", text);
      },
      end() {
        emit("end");
        emit("close");
      },
      close() {
        emit("close");
      },
      error(_socket, error) {
        emit("error", error);
      },
      connectError(_socket, error) {
        emit("error", error);
      },
    },
  });

  return {
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener as HerdrSocketListener);
      listeners.set(event, list);
    },
    write(data) {
      if (bunSocket && opened) bunSocket.write(data);
      else writeQueue.push(data);
    },
    end() {
      bunSocket?.end();
    },
    close() {
      bunSocket?.end();
    },
    removeAllListeners() {
      listeners.clear();
    },
  };
}
