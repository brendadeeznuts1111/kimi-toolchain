import { makeDir } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { resolveHerdrSocketPath } from "../src/lib/herdr-unix-socket.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

function withHerdrHome<T>(fn: (home: string) => T | Promise<T>): T | Promise<T> {
  const home = testTempDir("kimi-herdr-sock-");
  makeDir(join(home, ".config", "herdr", "sessions", "dev"), { recursive: true });
  return withEnv({ HOME: home, HERDR_SESSION: undefined, HERDR_SOCKET_PATH: undefined }, () => {
    try {
      return fn(home);
    } finally {
      cleanupPath(home);
    }
  });
}

describe("herdr-unix-socket", () => {
  test("primary session resolves default socket", () => {
    withHerdrHome((home) => {
      expect(resolveHerdrSocketPath()).toBe(join(home, ".config", "herdr", "herdr.sock"));
      expect(resolveHerdrSocketPath("")).toBe(join(home, ".config", "herdr", "herdr.sock"));
      expect(resolveHerdrSocketPath("default")).toBe(join(home, ".config", "herdr", "herdr.sock"));
    });
  });

  test("named session resolves sessions/<name>/herdr.sock", () => {
    withHerdrHome((home) => {
      expect(resolveHerdrSocketPath("dev")).toBe(
        join(home, ".config", "herdr", "sessions", "dev", "herdr.sock")
      );
    });
  });

  test("HERDR_SOCKET_PATH overrides only primary session", () => {
    withHerdrHome((home) => {
      withEnv({ HERDR_SOCKET_PATH: "/tmp/custom-primary.sock" }, () => {
        expect(resolveHerdrSocketPath()).toBe("/tmp/custom-primary.sock");
        expect(resolveHerdrSocketPath("dev")).toBe(
          join(home, ".config", "herdr", "sessions", "dev", "herdr.sock")
        );
      });
    });
  });

  test("inherits HERDR_SESSION env when session arg omitted", () => {
    withHerdrHome((home) => {
      withEnv({ HERDR_SESSION: "dev" }, () => {
        expect(resolveHerdrSocketPath()).toBe(
          join(home, ".config", "herdr", "sessions", "dev", "herdr.sock")
        );
      });
    });
  });
});
