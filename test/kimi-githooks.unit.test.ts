import { describe, expect, test } from "bun:test";
import { buildGlobalHooksPathCheck } from "../src/bin/kimi-githooks.ts";

describe("kimi-githooks global config checks", () => {
  test("passes when global hooks path is unset", () => {
    expect(buildGlobalHooksPathCheck(null)).toEqual({
      name: "global-hooks-path",
      status: "ok",
      message: "global core.hooksPath unset",
      fixable: false,
    });
  });

  test("warns when global hooks path can override repo-local policy", () => {
    const check = buildGlobalHooksPathCheck("~/.config/git/hooks\n");

    expect(check.status).toBe("warn");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("repo-local hooks");
  });
});
