import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveHerdrSocketPath } from "../src/lib/herdr-unix-socket.ts";

let tmpHome: string;
let priorSocketPath: string | undefined;

describe("herdr-unix-socket", () => {
  beforeEach(() => {
    tmpHome = join(tmpdir(), `kimi-herdr-sock-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tmpHome, ".config", "herdr", "sessions", "dev"), { recursive: true });
    priorSocketPath = process.env.HERDR_SOCKET_PATH;
    process.env.HOME = tmpHome;
    delete process.env.HERDR_SESSION;
    delete process.env.HERDR_SOCKET_PATH;
  });

  afterEach(() => {
    if (priorSocketPath === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = priorSocketPath;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
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
    process.env.HERDR_SOCKET_PATH = "/tmp/custom-primary.sock";
    expect(resolveHerdrSocketPath()).toBe("/tmp/custom-primary.sock");
    expect(resolveHerdrSocketPath("dev")).toBe(
      join(tmpHome, ".config", "herdr", "sessions", "dev", "herdr.sock")
    );
  });

  test("inherits HERDR_SESSION env when session arg omitted", () => {
    process.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSocketPath()).toBe(
      join(tmpHome, ".config", "herdr", "sessions", "dev", "herdr.sock")
    );
  });
});
