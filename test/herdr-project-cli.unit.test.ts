import { describe, expect, test } from "bun:test";
import {
  ensureJsonArgs,
  herdrSessionArgs,
  herdrSessionEnv,
  herdrSubcommandKey,
  resolveHerdrSession,
} from "../src/lib/herdr-project-cli.ts";
import { withEnv } from "./helpers.ts";

describe("herdr-project-cli", () => {
  test("uses --session CLI arg when HERDR_SESSION is set (Herdr 0.7.0)", () => {
    withEnv({ HERDR_SESSION: "dev" }, () => {
      expect(resolveHerdrSession()).toBe("dev");
      expect(herdrSessionArgs()).toEqual(["--session", "dev"]);
      expect(herdrSessionEnv().HERDR_SESSION).toBe("dev");
    });
  });

  test("primary server clears HERDR_SESSION and HERDR_SOCKET_PATH", () => {
    withEnv({ HERDR_SESSION: "dev", HERDR_SOCKET_PATH: "/tmp/stale.sock" }, () => {
      const env = herdrSessionEnv("default");
      expect(env.HERDR_SESSION).toBeUndefined();
      expect(env.HERDR_SOCKET_PATH).toBeUndefined();
    });
  });

  test("treats default and empty as primary server", () => {
    withEnv({ HERDR_SESSION: "default" }, () => {
      expect(resolveHerdrSession()).toBe("");
      expect(herdrSessionArgs()).toEqual([]);
      expect(herdrSessionEnv().HERDR_SESSION).toBeUndefined();
    });

    withEnv({ HERDR_SESSION: "" }, () => {
      expect(resolveHerdrSession()).toBe("");
      expect(herdrSessionArgs()).toEqual([]);
    });
  });

  test("explicit session overrides env in child env", () => {
    withEnv({ HERDR_SESSION: "dev" }, () => {
      expect(resolveHerdrSession("staging")).toBe("staging");
      expect(herdrSessionArgs("staging")).toEqual(["--session", "staging"]);
      expect(herdrSessionEnv("staging").HERDR_SESSION).toBe("staging");
    });
  });

  test("herdrSubcommandKey strips flags for subcommand matching", () => {
    expect(herdrSubcommandKey(["pane", "list", "--workspace", "wB"])).toBe("pane list");
    expect(herdrSubcommandKey(["plugin", "list", "--json"])).toBe("plugin list");
  });

  test("ensureJsonArgs appends --json only for Herdr subcommands that accept it", () => {
    expect(ensureJsonArgs(["session", "list"])).toEqual(["session", "list", "--json"]);
    expect(ensureJsonArgs(["plugin", "list"])).toEqual(["plugin", "list", "--json"]);
    expect(ensureJsonArgs(["server", "agent-manifests"])).toEqual([
      "server",
      "agent-manifests",
      "--json",
    ]);
    expect(ensureJsonArgs(["workspace", "list"])).toEqual(["workspace", "list"]);
    expect(ensureJsonArgs(["pane", "list"])).toEqual(["pane", "list"]);
    expect(ensureJsonArgs(["agent", "list"])).toEqual(["agent", "list"]);
    expect(ensureJsonArgs(["plugin", "list", "--json"])).toEqual(["plugin", "list", "--json"]);
  });
});
