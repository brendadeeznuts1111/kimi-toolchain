import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import {
  DEFAULT_HERDR_SOCKET_RECONNECT_DELAYS_MS,
  HERDR_SOCKET_SATURATION_RECONNECT_FLOOR_MS,
  isHerdrSocketSaturationError,
  resolveHerdrReconnectDelayMs,
  resolveReconnectDelaysMs,
} from "../src/lib/herdr-socket-client.ts";
import { createRejectingUnixServer } from "./fixtures/rejecting-unix-server.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

describe("herdr-socket-saturation backoff", () => {
  test("isHerdrSocketSaturationError matches EAGAIN and os error 35", () => {
    expect(isHerdrSocketSaturationError("connect EAGAIN")).toBe(true);
    expect(
      isHerdrSocketSaturationError(
        "herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)"
      )
    ).toBe(true);
    expect(isHerdrSocketSaturationError("connect ECONNREFUSED")).toBe(false);
    expect(isHerdrSocketSaturationError("socket closed unexpectedly")).toBe(false);
  });

  test("resolveHerdrReconnectDelayMs uses 8s floor on first saturation attempt", () => {
    const delays = [...DEFAULT_HERDR_SOCKET_RECONNECT_DELAYS_MS];
    expect(resolveHerdrReconnectDelayMs("connect EAGAIN", 0, delays)).toBe(
      HERDR_SOCKET_SATURATION_RECONNECT_FLOOR_MS
    );
    expect(resolveHerdrReconnectDelayMs("connect EAGAIN", 1, delays)).toBe(delays[1]);
  });

  test("resolveHerdrReconnectDelayMs keeps 1s first delay for non-saturation errors", () => {
    const delays = [...DEFAULT_HERDR_SOCKET_RECONNECT_DELAYS_MS];
    expect(resolveHerdrReconnectDelayMs("connect ECONNREFUSED", 0, delays)).toBe(1_000);
    expect(resolveHerdrReconnectDelayMs("socket closed unexpectedly", 0, delays)).toBe(1_000);
  });

  test("HERDR_SOCKET_TEST_RECONNECT_MS does not bypass saturation floor on attempt 0", () => {
    withEnv({ HERDR_SOCKET_TEST_RECONNECT_MS: "5,10" }, () => {
      const delays = resolveReconnectDelaysMs();
      expect(resolveHerdrReconnectDelayMs("connect EAGAIN", 0, delays)).toBe(
        HERDR_SOCKET_SATURATION_RECONNECT_FLOOR_MS
      );
      expect(resolveHerdrReconnectDelayMs("socket closed unexpectedly", 0, delays)).toBe(5);
    });
  });

  test("rejecting unix server stop removes socket file (Bun >= 1.1 cleanup)", async () => {
    const dir = testTempDir("herdr-sock-cleanup-");
    const socketPath = join(dir, "herdr.sock");
    const server = createRejectingUnixServer(socketPath);
    try {
      expect(pathExists(socketPath)).toBe(true);
      server.stop();
      await Bun.sleep(30);
      expect(pathExists(socketPath)).toBe(false);
    } finally {
      cleanupPath(dir);
    }
  });

  test("second bind on active unix socket throws EADDRINUSE", () => {
    const dir = testTempDir("herdr-sock-eaddrinuse-");
    const socketPath = join(dir, "herdr.sock");
    const server = createRejectingUnixServer(socketPath);
    try {
      expect(() => createRejectingUnixServer(socketPath)).toThrow(
        /EADDRINUSE|Address already in use/i
      );
    } finally {
      server.stop();
      cleanupPath(dir);
    }
  });
});
