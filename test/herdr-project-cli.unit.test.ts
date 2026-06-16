import { afterEach, describe, expect, test } from "bun:test";
import {
  herdrSessionArgs,
  herdrSessionEnv,
  resolveHerdrSession,
} from "../src/lib/herdr-project-cli.ts";

const prior = process.env.HERDR_SESSION;

afterEach(() => {
  if (prior === undefined) delete process.env.HERDR_SESSION;
  else process.env.HERDR_SESSION = prior;
});

describe("herdr-project-cli", () => {
  test("uses HERDR_SESSION when set (named — not socket-routed on Herdr 0.7.0)", () => {
    process.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSession()).toBe("dev");
    expect(herdrSessionArgs()).toEqual([]);
    expect(herdrSessionEnv().HERDR_SESSION).toBe("dev");
  });

  test("primary server clears HERDR_SESSION and HERDR_SOCKET_PATH", () => {
    process.env.HERDR_SESSION = "dev";
    process.env.HERDR_SOCKET_PATH = "/tmp/stale.sock";
    const env = herdrSessionEnv("default");
    expect(env.HERDR_SESSION).toBeUndefined();
    expect(env.HERDR_SOCKET_PATH).toBeUndefined();
  });

  test("treats default and empty as primary server", () => {
    process.env.HERDR_SESSION = "default";
    expect(resolveHerdrSession()).toBe("");
    expect(herdrSessionArgs()).toEqual([]);
    expect(herdrSessionEnv().HERDR_SESSION).toBeUndefined();

    process.env.HERDR_SESSION = "";
    expect(resolveHerdrSession()).toBe("");
    expect(herdrSessionArgs()).toEqual([]);
  });

  test("explicit session overrides env in child env", () => {
    process.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSession("staging")).toBe("staging");
    expect(herdrSessionEnv("staging").HERDR_SESSION).toBe("staging");
  });
});
