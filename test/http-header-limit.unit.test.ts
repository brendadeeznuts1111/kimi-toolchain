/**
 * HTTP header count limit regression test.
 *
 * Bun v1.3.14 increased max headers from 100 to 200.
 */
import { describe, expect, test } from "bun:test";

describe("http-header-limit", () => {
  test("200 custom headers accepted in Bun.serve response", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        const headers = new Headers();
        for (let i = 0; i < 200; i++) {
          headers.set(`x-custom-${i}`, `v${i}`);
        }
        // Headers object allows 200+ entries even pre-1.3.14 —
        // the fix applies to wire-level parsing, not JS Headers API.
        return new Response("ok", { headers });
      },
    });
    try {
      const res = await fetch(`http://localhost:${server.port}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-custom-0")).toBe("v0");
      expect(res.headers.get("x-custom-199")).toBe("v199");
    } finally {
      server.stop(true);
    }
  });
});
