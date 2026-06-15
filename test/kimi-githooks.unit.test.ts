import { describe, expect, test } from "bun:test";
import { buildGlobalHooksPathCheck, buildIdentityProfileCheck } from "../src/bin/kimi-githooks.ts";

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

  test("passes when identity matches detected profile", () => {
    const check = buildIdentityProfileCheck({
      expectedProfile: {
        name: "personal",
        userName: "Brenda Williams",
        userEmail: "205237647+brendadeeznuts1111@users.noreply.github.com",
      },
      identity: {
        userName: "Brenda Williams",
        userEmail: "205237647+brendadeeznuts1111@users.noreply.github.com",
      },
    });

    expect(check.status).toBe("ok");
    expect(check.fixable).toBe(false);
  });

  test("warns when identity differs from detected profile", () => {
    const check = buildIdentityProfileCheck({
      expectedProfile: {
        name: "work",
        userName: "DuoPlus Development Team",
        userEmail: "dev@duoplus.com",
      },
      identity: {
        userName: "Brenda Williams",
        userEmail: "205237647+brendadeeznuts1111@users.noreply.github.com",
      },
    });

    expect(check.status).toBe("warn");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("expected work");
  });
});
