import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import {
  describeHerdrSocketTransport,
  formatHerdrSocketPayload,
  probeHerdrSocketTransport,
  resolveHerdrSocketTransport,
} from "../src/lib/herdr-socket-transport.ts";
import { resolveHerdrWsUnixUrl } from "../src/lib/herdr-ws-unix.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

describe("herdr-socket-transport", () => {
  test("resolveHerdrSocketTransport reads env", () => {
    withEnv({ HERDR_SOCKET_TRANSPORT: undefined }, () => {
      expect(resolveHerdrSocketTransport()).toBe("jsonl");
    });
    withEnv({ HERDR_SOCKET_TRANSPORT: "websocket" }, () => {
      expect(resolveHerdrSocketTransport()).toBe("websocket");
    });
    withEnv({ HERDR_SOCKET_TRANSPORT: "ws" }, () => {
      expect(resolveHerdrSocketTransport()).toBe("websocket");
    });
    withEnv({ HERDR_SOCKET_TRANSPORT: "auto" }, () => {
      expect(resolveHerdrSocketTransport()).toBe("auto");
    });
    withEnv({ HERDR_SOCKET_TRANSPORT: "JSONL" }, () => {
      expect(resolveHerdrSocketTransport()).toBe("jsonl");
    });
  });

  test("describeHerdrSocketTransport labels active transport", () => {
    expect(describeHerdrSocketTransport("jsonl")).toBe("jsonl");
    expect(describeHerdrSocketTransport("websocket")).toBe("ws+unix");
    expect(describeHerdrSocketTransport("websocket-fallback")).toBe(
      "jsonl (websocket unavailable)"
    );
  });

  test("formatHerdrSocketPayload newline only for jsonl", () => {
    const body = { method: "ping" };
    expect(formatHerdrSocketPayload(body, "jsonl")).toBe(`${JSON.stringify(body)}\n`);
    expect(formatHerdrSocketPayload(body, "websocket")).toBe(JSON.stringify(body));
  });

  test("probeHerdrSocketTransport resolves path and ws support", () => {
    const home = testTempDir("kimi-herdr-probe-");
    makeDir(join(home, ".config", "herdr", "sessions", "dev"), { recursive: true });
    try {
      withEnv(
        {
          HOME: home,
          HERDR_SESSION: undefined,
          HERDR_SOCKET_PATH: undefined,
          HERDR_SOCKET_TRANSPORT: "auto",
        },
        () => {
          const probe = probeHerdrSocketTransport();
          expect(probe.transport).toBe("auto");
          expect(probe.socketPath).toBe(join(home, ".config", "herdr", "herdr.sock"));
          expect(probe.wsSupported).toBe(typeof WebSocket !== "undefined");
          if (probe.wsSupported) {
            expect(resolveHerdrWsUnixUrl(probe.socketPath)).toMatch(/^ws\+unix:\/\//);
          }
        }
      );
    } finally {
      cleanupPath(home);
    }
  });

  test("probeHerdrSocketTransport honors explicit socket path", () => {
    withEnv({ HERDR_SOCKET_TRANSPORT: "jsonl" }, () => {
      const probe = probeHerdrSocketTransport("/tmp/custom.sock");
      expect(probe.transport).toBe("jsonl");
      expect(probe.socketPath).toBe("/tmp/custom.sock");
    });
  });
});
