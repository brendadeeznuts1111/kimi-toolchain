import { describe, expect, mock, test } from "bun:test";
import { withEnv } from "./helpers.ts";

describe("herdr-socket-saturation-subscribe reconnect", () => {
  test("schedules 8s first reconnect when connect error is EAGAIN", async () => {
    mock.module("../src/lib/herdr-unix-socket.ts", () => ({
      resolveHerdrSocketPath: () => "/mock/herdr.sock",
      connectHerdrUnixSocket: () => {
        const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
        const emit = (event: string, ...args: unknown[]) => {
          for (const listener of listeners.get(event) ?? []) listener(...args);
        };

        queueMicrotask(() => emit("open"));

        return {
          on(event: string, listener: (...args: unknown[]) => void) {
            const list = listeners.get(event) ?? [];
            list.push(listener);
            listeners.set(event, list);
          },
          write() {
            emit("error", new Error("connect EAGAIN"));
          },
          end() {},
          close() {},
          removeAllListeners() {
            listeners.clear();
          },
        };
      },
    }));

    try {
      const { herdrSocketSubscribe, HERDR_SOCKET_SATURATION_RECONNECT_FLOOR_MS } =
        await import("../src/lib/herdr-socket-client.ts");

      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((
        callback: (...args: unknown[]) => void,
        ms?: number,
        ...args: unknown[]
      ) => {
        delays.push(Number(ms));
        return (
          originalSetTimeout as (
            callback: (...args: unknown[]) => void,
            ms?: number,
            ...args: unknown[]
          ) => ReturnType<typeof setTimeout>
        )(callback, 0, ...args);
      }) as unknown as typeof setTimeout;

      try {
        withEnv(
          { HERDR_SOCKET_TRANSPORT: "jsonl", HERDR_SOCKET_TEST_RECONNECT_MS: undefined },
          () => {
            herdrSocketSubscribe({
              subscriptions: [{ type: "workspace.updated" }],
              onEvent: () => {},
            });
          }
        );
        await Bun.sleep(40);
        expect(delays[0]).toBe(HERDR_SOCKET_SATURATION_RECONNECT_FLOOR_MS);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    } finally {
      mock.restore();
    }
  });
});
