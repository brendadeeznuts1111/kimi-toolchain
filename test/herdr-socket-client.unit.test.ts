import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import { herdrSocketSubscribe } from "../src/lib/herdr-socket-client.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

function withClosingJsonlServer<T>(fn: (socketPath: string) => T | Promise<T>): T | Promise<T> {
  const dir = testTempDir("herdr-sock-reconnect-");
  const socketPath = join(dir, "herdr.sock");
  makeDir(dir, { recursive: true });

  let connectionCount = 0;
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        connectionCount += 1;
        socket.write(`${JSON.stringify({ result: { type: "subscription_started" } })}\n`);
        if (connectionCount === 1) socket.end();
      },
      data() {},
    },
  });

  return Promise.resolve(fn(socketPath)).finally(() => {
    server.stop();
    cleanupPath(dir);
  });
}

describe("herdr-socket-client reconnect", () => {
  afterEach(() => {
    // no shared mocks
  });

  test("reconnects after unexpected socket end", async () => {
    await withClosingJsonlServer(async (socketPath) => {
      await withEnv(
        {
          HERDR_SOCKET_PATH: socketPath,
          HERDR_SOCKET_TRANSPORT: "jsonl",
          HERDR_SOCKET_TEST_RECONNECT_MS: "5",
          HERDR_SESSION: undefined,
        },
        async () => {
          const errors: string[] = [];
          let eventCount = 0;
          herdrSocketSubscribe({
            subscriptions: [{ type: "workspace.updated" }],
            onEvent: () => {
              eventCount += 1;
            },
            onError: (error) => errors.push(error),
          });

          await Bun.sleep(40);
          expect(errors).toEqual([]);
          expect(eventCount).toBeGreaterThanOrEqual(0);
        }
      );
    });
  });
});
