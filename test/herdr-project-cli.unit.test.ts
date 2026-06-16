import { afterEach, describe, expect, test } from "bun:test";
import { herdrSessionArgs, resolveHerdrSession } from "../src/lib/herdr-project-cli.ts";

const prior = process.env.HERDR_SESSION;

afterEach(() => {
  if (prior === undefined) delete process.env.HERDR_SESSION;
  else process.env.HERDR_SESSION = prior;
});

describe("herdr-project-cli", () => {
  test("uses HERDR_SESSION when set", () => {
    process.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSession()).toBe("dev");
    expect(herdrSessionArgs()).toEqual(["--session", "dev"]);
  });

  test("treats default and empty as primary server", () => {
    process.env.HERDR_SESSION = "default";
    expect(resolveHerdrSession()).toBe("");
    expect(herdrSessionArgs()).toEqual([]);

    process.env.HERDR_SESSION = "";
    expect(resolveHerdrSession()).toBe("");
    expect(herdrSessionArgs()).toEqual([]);
  });

  test("explicit session overrides env", () => {
    process.env.HERDR_SESSION = "dev";
    expect(resolveHerdrSession("staging")).toBe("staging");
    expect(herdrSessionArgs("staging")).toEqual(["--session", "staging"]);
  });
});
