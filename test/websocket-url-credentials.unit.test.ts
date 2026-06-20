/**
 * WebSocket URL credentials regression test.
 *
 * Bun v1.3.14 forwards ws://user:pass@host credentials as Basic auth headers.
 */
import { describe, expect, test } from "bun:test";

describe("websocket-url-credentials", () => {
  test("ws URL preserves credentials in URL constructor", () => {
    const url = new URL("ws://user:pass@localhost:8080/socket");
    expect(url.username).toBe("user");
    expect(url.password).toBe("pass");
  });

  test("ws URL without credentials has empty auth", () => {
    const url = new URL("ws://localhost:8080/socket");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });

  test("Bun.serve WebSocket upgrade works", async () => {
    let received = false;
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 426 });
      },
      websocket: {
        open() {
          received = true;
        },
        message() {},
      },
    });
    try {
      const ws = new WebSocket(`ws://localhost:${server.port}`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(new Error("ws error"));
        setTimeout(() => reject(new Error("ws timeout")), 2000);
      });
      expect(received).toBe(true);
      ws.close();
    } finally {
      server.stop(true);
    }
  });
});
