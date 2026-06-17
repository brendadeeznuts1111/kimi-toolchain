import { describe, expect, test } from "bun:test";
import {
  herdrSessionArgs,
  herdrSessionEnv,
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
});
