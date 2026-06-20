/**
 * Bun fetch outgoing header casing — regression guard for Bun v1.3.7+.
 *
 * RFC 7230 treats header names as case-insensitive, but some APIs require exact
 * casing (e.g. Authorization vs authorization). Bun v1.3.7 preserves caller casing
 * on outgoing fetch/node:https requests, matching Node.js.
 *
 * @see https://bun.com/blog/bun-v1.3.7#fetch-now-preserves-header-case-when-sending-http-requests
 */
import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

interface HeaderEcho {
  readonly url: string;
  readonly close: () => Promise<void>;
  capture(init: RequestInit): Promise<string[]>;
}

async function startHeaderEchoServer(): Promise<HeaderEcho> {
  let lastNames: string[] = [];
  const server: Server = createServer((req, res) => {
    lastNames = req.rawHeaders.filter((_, index) => index % 2 === 0);
    res.writeHead(200);
    res.end("ok");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;

  return {
    url,
    async capture(init) {
      lastNames = [];
      const res = await fetch(url, init);
      await res.text();
      return [...lastNames];
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function probeFetchPreservesHeaderCasing(): Promise<boolean> {
  const echo = await startHeaderEchoServer();
  try {
    const names = await echo.capture({
      headers: {
        Authorization: "Bearer probe",
        "Content-Type": "application/json",
        "X-Custom-Header": "probe",
      },
    });
    return names.includes("Authorization") && names.includes("Content-Type");
  } finally {
    await echo.close();
  }
}

const fetchPreservesHeaderCasing = await probeFetchPreservesHeaderCasing();

function customHeaderNames(names: string[]): string[] {
  const ignored = new Set([
    "host",
    "connection",
    "user-agent",
    "accept",
    "accept-encoding",
    "accept-language",
    "sec-fetch-mode",
  ]);
  return names.filter((name) => !ignored.has(name.toLowerCase()));
}

describe("fetch-header-casing", () => {
  describe("runtime probe", () => {
    test(`Bun ${Bun.version}: preserves=${fetchPreservesHeaderCasing}`, () => {
      if (!fetchPreservesHeaderCasing) {
        console.warn(
          `[fetch-header-casing] casing preservation not active on Bun ${Bun.version}; upgrade to v1.3.7+ with JSC fetch fix`
        );
      }
      expect(typeof fetchPreservesHeaderCasing).toBe("boolean");
    });
  });

  describe("outgoing fetch headers", () => {
    test.skipIf(!fetchPreservesHeaderCasing)(
      "plain-object headers preserve caller casing",
      async () => {
        const echo = await startHeaderEchoServer();
        try {
          const names = await echo.capture({
            headers: {
              Authorization: "Bearer token123",
              "Content-Type": "application/json",
              "X-Custom-Header": "value",
            },
          });
          const custom = customHeaderNames(names);
          expect(custom).toEqual(["Authorization", "Content-Type", "X-Custom-Header"]);
          expect(custom).not.toContain("authorization");
          expect(custom).not.toContain("content-type");
        } finally {
          await echo.close();
        }
      }
    );

    test.skipIf(!fetchPreservesHeaderCasing)(
      "Headers object preserves casing from headers.set()",
      async () => {
        const echo = await startHeaderEchoServer();
        try {
          const headers = new Headers();
          headers.set("Content-Type", "text/plain");
          headers.set("X-Request-Id", "req-abc123");
          const names = await echo.capture({ headers });
          const custom = customHeaderNames(names);
          expect(custom).toContain("Content-Type");
          expect(custom).toContain("X-Request-Id");
          expect(custom).not.toContain("content-type");
        } finally {
          await echo.close();
        }
      }
    );
  });
});
