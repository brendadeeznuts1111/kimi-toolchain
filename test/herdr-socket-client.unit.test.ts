import { afterEach, describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import { testTempDir, withEnv } from "./helpers.ts";

type SocketListener = (...args: unknown[]) => void;

interface MockSocketOptions {
  ackOnWrite?: boolean;
  failOnWrite?: boolean;
  endAfterAck?: boolean;
}

function createMockSocket(options: MockSocketOptions = {}) {
  const listeners = new Map<string, SocketListener[]>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };

  return {
    transport: "jsonl" as const,
    on(event: string, listener: SocketListener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    write(_data: string) {
      if (options.failOnWrite) {
        queueMicrotask(() => emit("error", new Error("socket write failed")));
        return;
      }
      if (options.ackOnWrite !== false) {
        queueMicrotask(() => {
          emit("data", `${JSON.stringify({ result: { type: "subscription_started" } })}\n`);
          if (options.endAfterAck) {
            queueMicrotask(() => {
              emit("end");
              emit("close");
            });
          }
        });
      }
    },
    end() {},
    close() {},
    removeAllListeners() {
      listeners.clear();
    },
  };
}

let connectCount = 0;
let endAfterEveryAck = false;

mock.module("../src/lib/herdr-socket-transport.ts", () => ({
  connectHerdrSocket: () => {
    connectCount += 1;
    const endAfterAck = endAfterEveryAck || connectCount === 1;
    return createMockSocket({
      ackOnWrite: true,
      endAfterAck,
    });
  },
  formatHerdrSocketPayload: (payload: Record<string, unknown>) => `${JSON.stringify(payload)}\n`,
  resolveHerdrSocketTransport: () => "jsonl",
}));

const { herdrSocketSubscribe } = await import("../src/lib/herdr-socket-client.ts");

describe("herdr-socket-client reconnect", () => {
  afterEach(() => {
    connectCount = 0;
    endAfterEveryAck = false;
  });

  test("reconnects after unexpected socket end", async () => {
    await withEnv(
      {
        HERDR_SOCKET_TEST_RECONNECT_MS: "1",
        HOME: (() => {
          const home = testTempDir("herdr-sock-reconnect-");
          makeDir(join(home, ".config", "herdr"), { recursive: true });
          return home;
        })(),
      },
      async () => {
        const errors: string[] = [];
        herdrSocketSubscribe({
          subscriptions: [{ type: "workspace.updated" }],
          onEvent: () => {},
          onError: (error) => errors.push(error),
        });

        await Bun.sleep(20);
        expect(connectCount).toBeGreaterThanOrEqual(2);
        expect(errors).toEqual([]);
      }
    );
  });

  test("reports error after max reconnect attempts", async () => {
    endAfterEveryAck = true;
    await withEnv(
      {
        HERDR_SOCKET_TEST_RECONNECT_MS: "1,1,1,1,1",
        HOME: (() => {
          const home = testTempDir("herdr-sock-reconnect-max-");
          makeDir(join(home, ".config", "herdr"), { recursive: true });
          return home;
        })(),
      },
      async () => {
        const errors: string[] = [];
        herdrSocketSubscribe({
          subscriptions: [{ type: "workspace.updated" }],
          onEvent: () => {},
          onError: (error) => errors.push(error),
        });

        await Bun.sleep(150);
        expect(connectCount).toBeGreaterThanOrEqual(5);
        expect(errors.some((e) => e.includes("reconnect failed after 5 attempts"))).toBe(true);
      }
    );
  });
});
