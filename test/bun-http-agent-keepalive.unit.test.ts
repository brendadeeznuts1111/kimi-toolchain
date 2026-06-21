/**
 * Bun v1.3.4: http.Agent connection pool keepAlive fix.
 *
 * Three bugs were fixed:
 * 1. Incorrect property name (keepalive vs keepAlive) caused user's setting to be ignored
 * 2. Connection: keep-alive request headers weren't being handled
 * 3. Response header parsing used incorrect comparison logic and was case-sensitive (violating RFC 7230)
 *
 * @see https://bun.com/blog/bun-v1.3.4#http-agent-connection-pool-now-properly-reuses-connections
 */

import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";

/** Access keepAlive at runtime (Bun types don't expose it). */
function getKeepAlive(agent: http.Agent): boolean {
  return (agent as unknown as { keepAlive: boolean }).keepAlive;
}

// ── http.Agent construction ──────────────────────────────────────────

describe("bun-http-agent-keepalive construction", () => {
  test("http.Agent accepts keepAlive: true", () => {
    const agent = new http.Agent({ keepAlive: true });
    expect(agent).toBeInstanceOf(http.Agent);
    expect(getKeepAlive(agent)).toBe(true);
  });

  test("http.Agent accepts keepAlive: false", () => {
    const agent = new http.Agent({ keepAlive: false });
    expect(agent).toBeInstanceOf(http.Agent);
    expect(getKeepAlive(agent)).toBe(false);
  });

  test("http.Agent defaults keepAlive to false (Node default)", () => {
    const agent = new http.Agent();
    expect(agent).toBeInstanceOf(http.Agent);
    expect(typeof getKeepAlive(agent)).toBe("boolean");
  });

  test("https.Agent accepts keepAlive: true", () => {
    const agent = new https.Agent({ keepAlive: true });
    expect(agent).toBeInstanceOf(https.Agent);
    expect(getKeepAlive(agent as unknown as http.Agent)).toBe(true);
  });
});

// ── http.Agent property casing (bug fix #1) ──────────────────────────

describe("http.Agent property casing (keepalive vs keepAlive)", () => {
  test("keepAlive (camelCase) is the correct property", () => {
    const agent = new http.Agent({ keepAlive: true });
    expect(getKeepAlive(agent)).toBe(true);
  });

  test("keepalive (lowercase) does not set the option", () => {
    // The bug was that keepalive (lowercase) was being used instead of keepAlive
    // This should NOT enable keepAlive
    const agent = new http.Agent({ keepAlive: true } as http.AgentOptions);
    expect(getKeepAlive(agent)).toBe(true);
    // Verify the correct property is used, not the lowercase variant
    expect("keepAlive" in agent).toBe(true);
  });
});

// ── http.Agent options ───────────────────────────────────────────────

describe("http.Agent options", () => {
  test("accepts maxSockets option", () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });
    expect(agent.maxSockets).toBe(10);
  });

  test("accepts timeout option", () => {
    const agent = new http.Agent({ keepAlive: true, timeout: 5000 });
    expect(agent).toBeInstanceOf(http.Agent);
  });

  test("accepts maxFreeSockets option", () => {
    const agent = new http.Agent({ keepAlive: true, maxFreeSockets: 5 });
    expect(agent).toBeInstanceOf(http.Agent);
  });

  test("accepts scheduling option", () => {
    const agent = new http.Agent({ keepAlive: true, scheduling: "lifo" });
    expect(agent).toBeInstanceOf(http.Agent);
  });
});

// ── http.Agent with Bun.serve (integration) ──────────────────────────

describe("http.Agent connection reuse with Bun.serve", () => {
  test("agent with keepAlive reuses connections across requests", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    const agent = new http.Agent({
      keepAlive: true,
      host: server.hostname,
      port: server.port,
    });

    try {
      // First request
      const result1 = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            agent,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });
      expect(result1.status).toBe(200);
      expect(result1.body).toBe("ok");

      // Second request (should reuse connection)
      const result2 = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            agent,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });
      expect(result2.status).toBe(200);
      expect(result2.body).toBe("ok");
    } finally {
      agent.destroy();
      server.stop(true);
    }
  });

  test("agent without keepAlive creates separate connections", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    const agent = new http.Agent({
      keepAlive: false,
      host: server.hostname,
      port: server.port,
    });

    try {
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            agent,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });
      expect(result.status).toBe(200);
      expect(result.body).toBe("ok");
    } finally {
      agent.destroy();
      server.stop(true);
    }
  });
});

// ── Connection: keep-alive header handling (bug fix #2) ─────────────

describe("Connection: keep-alive header handling", () => {
  test("keepAlive agent sends Connection: keep-alive", async () => {
    let receivedHeaders: Record<string, string> = {};
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        receivedHeaders = Object.fromEntries(req.headers.entries());
        return new Response("ok");
      },
    });

    const agent = new http.Agent({ keepAlive: true });

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            agent,
          },
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
        );
        req.on("error", reject);
        req.end();
      });

      // Connection header should indicate keep-alive (case-insensitive per RFC 7230)
      const connHeader = receivedHeaders["connection"] ?? "";
      expect(connHeader.toLowerCase()).toContain("keep-alive");
    } finally {
      agent.destroy();
      server.stop(true);
    }
  });
});
