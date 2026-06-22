import { describe, expect, test } from "bun:test";
import {
  buildServeErrorResponse,
  serveErrorCallback,
  serveRequestContext,
  withServeRequestContext,
} from "../src/lib/serve-error.ts";

describe("serve-error", () => {
  test("buildServeErrorResponse returns structured http domain JSON", async () => {
    const res = buildServeErrorResponse(new Error("handler blew up"), {
      route: "/api/test",
      method: "POST",
      includeStack: false,
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.domain).toBe("com.kimi.toolchain.http");
    expect(body.code).toBe("serve_handler_error");
    expect(body.error).toBe("handler blew up");
    expect(body.route).toBe("/api/test");
    expect(body.method).toBe("POST");
  });

  test("serveErrorCallback reads AsyncLocalStorage request context", async () => {
    const server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        return withServeRequestContext(
          { pathname: "/boom", method: "GET", startedAt: Bun.nanoseconds() },
          async () => {
            throw new Error("boom");
          }
        );
      },
      error: serveErrorCallback,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/boom`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.domain).toBe("com.kimi.toolchain.http");
      expect(body.route).toBe("/boom");
    } finally {
      server.stop();
    }
  });

  test("serveRequestContext is undefined outside run", () => {
    expect(serveRequestContext.getStore()).toBeUndefined();
  });
});
