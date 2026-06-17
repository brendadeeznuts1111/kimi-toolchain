import { pathExists, removePath } from "../src/lib/bun-io.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  desktopRuntimeDepsOk,
  provisionDesktopRuntimeDeps,
} from "../src/lib/desktop-runtime-deps.ts";

describe("desktop-runtime-deps", () => {
  const previousHome = Bun.env.HOME;

  afterEach(() => {
    Bun.env.HOME = previousHome;
  });

  test("provisionDesktopRuntimeDeps installs typescript into desktop root", async () => {
    const fakeHome = testTempDir("desktop-runtime-deps-");
    Bun.env.HOME = fakeHome;

    const result = await provisionDesktopRuntimeDeps();
    expect(result.installed).toBe(true);
    expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
    expect(
      pathExists(join(fakeHome, ".kimi-code", "node_modules", "typescript", "package.json"))
    ).toBe(true);

    removePath(fakeHome, { recursive: true, force: true });
  });
});
