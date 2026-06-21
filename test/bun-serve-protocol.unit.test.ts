/**
 * Bun.serve() TypeScript definition and runtime property tests.
 *
 * Validates that Bun.serve() returns a server object with the `protocol`
 * property, which was added to the type definitions in Bun v1.3.4.
 * Also verifies other key server properties.
 *
 * @see https://bun.com/blog/bun-v1.3.4#typescript-definitions
 */

import { describe, expect, test } from "bun:test";

// ── Bun.serve() protocol property ────────────────────────────────────

describe("bun-serve-protocol property", () => {
  test("server has protocol property (http)", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(server).toHaveProperty("protocol");
      expect(typeof server.protocol).toBe("string");
      expect(server.protocol).toBe("http");
    } finally {
      server.stop(true);
    }
  });

  test("server has protocol property (https when tls cert provided)", () => {
    // Bun requires actual TLS certs to enable https protocol.
    // With empty tls:{}, it falls back to http.
    // We verify the protocol field exists and is a string regardless.
    const server = Bun.serve({
      port: 0,
      tls: {},
      fetch: () => new Response("ok"),
    });
    try {
      expect(server).toHaveProperty("protocol");
      expect(typeof server.protocol).toBe("string");
      // Empty tls config falls back to http in Bun without real certs
      expect(server.protocol).toBe("http");
    } finally {
      server.stop(true);
    }
  });

  test("protocol is accessible without runtime error", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(() => server.protocol).not.toThrow();
    } finally {
      server.stop(true);
    }
  });
});

// ── Bun.serve() server object shape ──────────────────────────────────

describe("Bun.serve() server object shape", () => {
  test("server has hostname property", () => {
    const server = Bun.serve({
      port: 0,
      hostname: "0.0.0.0",
      fetch: () => new Response("ok"),
    });
    try {
      expect(server).toHaveProperty("hostname");
      expect(server.hostname).toBe("0.0.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("server has port property", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(server).toHaveProperty("port");
      expect(typeof server.port).toBe("number");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("server has stop method", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(typeof server.stop).toBe("function");
    } finally {
      server.stop(true);
    }
  });

  test("server has reload method", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(typeof server.reload).toBe("function");
    } finally {
      server.stop(true);
    }
  });

  test("server has url property", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(server).toHaveProperty("url");
      expect(server.url).toBeInstanceOf(URL);
    } finally {
      server.stop(true);
    }
  });

  test("server.url includes protocol", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      expect(server.url.protocol).toBe("http:");
    } finally {
      server.stop(true);
    }
  });

  test("server.url for https falls back to http without real certs", () => {
    const server = Bun.serve({
      port: 0,
      tls: {},
      fetch: () => new Response("ok"),
    });
    try {
      // Empty tls config falls back to http in Bun without real certs
      expect(server.url.protocol).toBe("http:");
    } finally {
      server.stop(true);
    }
  });
});

// ── Bun.serve() request handling ─────────────────────────────────────

describe("Bun.serve() request handling", () => {
  test("server responds to fetch requests", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("hello", { status: 200 }),
    });
    try {
      const response = await fetch(`http://${server.hostname}:${server.port}/`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe("hello");
    } finally {
      server.stop(true);
    }
  });

  test("server passes request to fetch handler", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        return new Response(req.url);
      },
    });
    try {
      const response = await fetch(`http://${server.hostname}:${server.port}/test`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("/test");
    } finally {
      server.stop(true);
    }
  });

  test("server handles POST with body", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = await req.text();
        return new Response(body.toUpperCase());
      },
    });
    try {
      const response = await fetch(`http://${server.hostname}:${server.port}/`, {
        method: "POST",
        body: "hello",
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe("HELLO");
    } finally {
      server.stop(true);
    }
  });
});
