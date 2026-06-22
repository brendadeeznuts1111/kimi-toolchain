import { describe, expect, test } from "bun:test";
import { apiServeMetrics } from "../examples/dashboard/src/handlers/serve-metrics.ts";
import {
  clearRegisteredServeMetricsSource,
  readRegisteredServeMetrics,
  registerServeMetricsSource,
  snapshotServeMetrics,
} from "../src/lib/serve-metrics.ts";

describe("serve-metrics", () => {
  test("snapshotServeMetrics reads pending counters", () => {
    const snapshot = snapshotServeMetrics({
      pendingRequests: 2,
      pendingWebSockets: 1,
      protocol: "http",
      port: 5678,
      hostname: "0.0.0.0",
      url: "http://127.0.0.1:5678/",
      development: true,
    });
    expect(snapshot.pendingRequests).toBe(2);
    expect(snapshot.pendingWebSockets).toBe(1);
    expect(snapshot.protocol).toBe("http");
    expect(snapshot.url).toBe("http://127.0.0.1:5678/");
  });

  test("pendingRequests reflects in-flight handlers", async () => {
    let peak = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(_req, srv) {
        peak = Math.max(peak, srv.pendingRequests);
        await Bun.sleep(40);
        return new Response("ok");
      },
    });

    try {
      await Promise.all([
        fetch(`http://127.0.0.1:${server.port}/a`),
        fetch(`http://127.0.0.1:${server.port}/b`),
      ]);
      expect(peak).toBeGreaterThanOrEqual(1);
    } finally {
      server.stop(true);
    }
  });

  test("subscriberCount increments after WebSocket subscribes to topic", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("fail", { status: 426 });
      },
      websocket: {
        open(ws) {
          ws.subscribe("chat");
        },
        message() {},
      },
    });

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("ws failed"));
        setTimeout(() => reject(new Error("ws timeout")), 2000);
      });

      expect(server.subscriberCount("chat")).toBe(1);
      expect(snapshotServeMetrics(server, ["chat"]).subscribers).toEqual({ chat: 1 });

      ws.close();
      await Bun.sleep(20);
      expect(server.subscriberCount("chat")).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("apiServeMetrics returns registered dashboard counters", async () => {
    clearRegisteredServeMetricsSource();
    registerServeMetricsSource({
      pendingRequests: 3,
      pendingWebSockets: 0,
      protocol: "http",
      port: 5678,
      hostname: "127.0.0.1",
      url: "http://127.0.0.1:5678/",
      development: false,
      subscriberCount: () => 0,
    });

    const res = await apiServeMetrics();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.metrics.pendingRequests).toBe(3);
    expect(body.metrics.pendingWebSockets).toBe(0);

    clearRegisteredServeMetricsSource();
    const missing = await apiServeMetrics();
    expect(missing.status).toBe(503);
    expect(readRegisteredServeMetrics()).toBeNull();
  });
});
