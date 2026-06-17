import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import {
  createJsonlLineBuffer,
  handleHerdrSubscribeFrame,
  parseHerdrSocketJsonLine,
} from "../src/lib/herdr-socket-protocol.ts";
import { herdrSocketSubscribe } from "../src/lib/herdr-socket-client.ts";
import {
  connectHerdrSocket,
  describeHerdrSocketTransport,
  formatHerdrSocketPayload,
} from "../src/lib/herdr-socket-transport.ts";
import { connectHerdrUnixSocket } from "../src/lib/herdr-unix-socket.ts";
import { resolveHerdrWsUnixUrl } from "../src/lib/herdr-ws-unix.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

async function withMockHerdrWsServer<T>(fn: (socketPath: string) => T | Promise<T>): Promise<T> {
  const dir = testTempDir("kimi-herdr-ws-");
  const socketPath = join(dir, "herdr.sock");
  makeDir(dir, { recursive: true });

  const server = Bun.serve({
    unix: socketPath,
    fetch(req, srv) {
      if (srv.upgrade(req)) return;
      return new Response("ok");
    },
    websocket: {
      message(ws, message) {
        const text = String(message);
        const json = JSON.parse(text) as { method?: string; id?: string };
        if (json.method === "events.subscribe") {
          ws.send(JSON.stringify({ id: json.id, result: { type: "subscription_started" } }));
          ws.send(
            JSON.stringify({
              event: "pane.agent_status_changed",
              data: { pane_id: "p1", custom_status: "idle" },
            })
          );
          return;
        }
        ws.send(JSON.stringify({ id: json.id, result: { ok: true } }));
        ws.close();
      },
    },
  });

  await Bun.sleep(50);
  try {
    return await fn(socketPath);
  } finally {
    server.stop();
    cleanupPath(dir);
  }
}

async function withMockHerdrJsonlServer<T>(fn: (socketPath: string) => T | Promise<T>): Promise<T> {
  const dir = testTempDir("kimi-herdr-jsonl-");
  const socketPath = join(dir, "herdr.sock");
  makeDir(dir, { recursive: true });

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(socket, data) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
        const line = text.trim();
        if (!line || line.startsWith("GET ") || line.startsWith("HTTP/")) return;
        let json: { method?: string; id?: string };
        try {
          json = JSON.parse(line) as { method?: string; id?: string };
        } catch {
          return;
        }
        if (json.method === "events.subscribe") {
          socket.write(
            `${JSON.stringify({ id: json.id, result: { type: "subscription_started" } })}\n`
          );
          socket.write(
            `${JSON.stringify({
              event: "pane.agent_status_changed",
              data: { pane_id: "p2" },
            })}\n`
          );
          return;
        }
        socket.write(`${JSON.stringify({ id: json.id, result: { ok: true } })}\n`);
        socket.end();
      },
    },
  });

  await Bun.sleep(50);
  try {
    return await fn(socketPath);
  } finally {
    server.stop();
    cleanupPath(dir);
  }
}

describe("herdr-ws-unix", () => {
  test("resolveHerdrWsUnixUrl builds ws+unix path", () => {
    expect(resolveHerdrWsUnixUrl("/tmp/herdr.sock")).toBe("ws+unix:///tmp/herdr.sock:/");
    expect(resolveHerdrWsUnixUrl("/tmp/herdr.sock", "/events")).toBe(
      "ws+unix:///tmp/herdr.sock:/events"
    );
  });

  test("parseHerdrSocketJsonLine and subscribe frame handler", () => {
    const state = { acked: false };
    const events: string[] = [];
    const ack = handleHerdrSubscribeFrame(
      { result: { type: "subscription_started" } },
      state,
      (env) => events.push(env.event || ""),
      () => undefined
    );
    expect(ack).toBe("subscription_ok");
    const routed = handleHerdrSubscribeFrame(
      { event: "workspace.updated", data: { workspace_id: "w1" } },
      state,
      (env) => events.push(env.event || "")
    );
    expect(routed).toBe("event");
    expect(events).toEqual(["workspace.updated"]);
    expect(parseHerdrSocketJsonLine("  ")).toBeNull();
  });

  test("createJsonlLineBuffer splits chunked lines", () => {
    const lines: string[] = [];
    const push = createJsonlLineBuffer((line) => lines.push(line));
    push('{"a":1}\n{"b":');
    push("2}\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("herdrSocketSubscribe over ws+unix receives events", async () => {
    await withMockHerdrWsServer(async (socketPath) => {
      const events: string[] = [];
      await withEnv(
        {
          HERDR_SOCKET_PATH: socketPath,
          HERDR_SOCKET_TRANSPORT: "websocket",
          HERDR_SESSION: undefined,
        },
        async () => {
          await new Promise<void>((resolve, reject) => {
            const socket = herdrSocketSubscribe({
              subscriptions: [{ type: "pane.agent_status_changed" }],
              transport: "websocket",
              onTransport: (transport) => {
                expect(describeHerdrSocketTransport(transport)).toBe("ws+unix");
              },
              onEvent: (envelope) => {
                events.push(envelope.event || "");
                socket.end();
              },
              onError: (message) => reject(new Error(message)),
            });
            socket.on("close", () => {
              try {
                expect(events).toEqual(["pane.agent_status_changed"]);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
        }
      );
    });
  });

  test("connectHerdrSocket auto falls back to jsonl", async () => {
    await withMockHerdrJsonlServer(async (socketPath) => {
      await withEnv({ HERDR_SOCKET_TRANSPORT: "auto", HERDR_SESSION: undefined }, async () => {
        await new Promise<void>((resolve, reject) => {
          let transport = "";
          const socket = connectHerdrSocket(socketPath, {
            transport: "auto",
            connectTimeoutMs: 400,
            onTransport: (active) => {
              transport = active;
            },
          });
          const payload = formatHerdrSocketPayload(
            { id: "t", method: "events.subscribe", params: { subscriptions: [] } },
            "jsonl"
          );
          socket.write(payload);
          const push = createJsonlLineBuffer((line) => {
            const json = parseHerdrSocketJsonLine(line);
            if (json?.result) {
              expect(transport).toBe("websocket-fallback");
              socket.end();
            }
          });
          socket.on("data", push);
          socket.on("error", (error) =>
            reject(error instanceof Error ? error : new Error(String(error)))
          );
          socket.on("close", () => resolve());
        });
      });
    });
  });

  test("jsonl connect still works for RPC-style responses", async () => {
    await withMockHerdrJsonlServer(async (socketPath) => {
      await new Promise<void>((resolve, reject) => {
        const socket = connectHerdrUnixSocket(socketPath);
        socket.write(
          formatHerdrSocketPayload({ id: "rpc", method: "layout.export", params: {} }, "jsonl")
        );
        const push = createJsonlLineBuffer((line) => {
          const json = parseHerdrSocketJsonLine(line);
          expect(json?.result).toEqual({ ok: true });
          socket.end();
        });
        socket.on("data", push);
        socket.on("error", (error) =>
          reject(error instanceof Error ? error : new Error(String(error)))
        );
        socket.on("close", () => resolve());
      });
    });
  });
});
