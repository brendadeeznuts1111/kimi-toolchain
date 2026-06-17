import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { resolveHerdrSocketPath } from "../src/lib/herdr-unix-socket.ts";

import { testTempDir } from "./helpers.ts";
let tmpHome: string;
let priorSocketPath: string | undefined;

describe("herdr-unix-socket", () => {
  beforeEach(() => {
    tmpHome = testTempDir("kimi-herdr-sock-");
    makeDir(join(tmpHome, ".config", "herdr", "sessions", "dev"), { recursive: true });
    priorSocketPath = Bun.env.HERDR_SOCKET_PATH;
    Bun.env.HOME = tmpHome;
    delete Bun.env.HERDR_SESSION;
    delete Bun.env.HERDR_SOCKET_PATH;
  });

  afterEach(() => {
    if (priorSocketPath === undefined) delete Bun.env.HERDR_SOCKET_PATH;
    else Bun.env.HERDR_SOCKET_PATH = priorSocketPath;
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("primary session resolves default socket", () => {
    expect(resolveHerdrSocketPath()).toBe(join(tmpHome, ".config", "herdr", "herdr.sock"));
    expect(resolveHerdrSocketPath("")).toBe(join(tmpHome, ".config", "herdr", "herdr.sock"));
    expect(resolveHerdrSocketPath("default")).toBe(join(tmpHome, ".config", "herdr", "herdr.sock"));
  });

  test("named session resolves sessions/<name>/herdr.sock", () => {
    expect(resolveHerdrSocketPath("dev")).toBe(
      join(tmpHome, ".config", "herdr", "sessions", "dev", "herdr.sock")
    );
  });

  test("HERDR_SOCKET_PATH overrides only primary session", () => {
    Bun.env.HERDR_SOCKET_PATH = "/tmp/custom-primary.sock";
    expect(resolveHerdrSocketPath()).toBe("/tmp/custom-primary.sock");
    expect(resolveHerdrSocketPath("dev")).toBe(
      join(tmpHome, ".config", "herdr", "sessions", "dev", "herdr.sock")
    );
  });

  test("inherits HERDR_SESSION env when session arg omitted", () => {
    Bun.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSocketPath()).toBe(
      join(tmpHome, ".config", "herdr", "sessions", "dev", "herdr.sock")
    );
  });
});
