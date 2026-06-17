import { pathExists } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { withIsolatedHome } from "./helpers.ts";
import {
  desktopRuntimeDepsOk,
  provisionDesktopRuntimeDeps,
} from "../src/lib/desktop-runtime-deps.ts";

describe("desktop-runtime-deps", () => {
  test("provisionDesktopRuntimeDeps installs typescript into desktop root", async () => {
    await withIsolatedHome(async (fakeHome) => {
      const result = await provisionDesktopRuntimeDeps();
      expect(result.installed).toBe(true);
      expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
      expect(
        pathExists(join(fakeHome, ".kimi-code", "node_modules", "typescript", "package.json"))
      ).toBe(true);
    });
  });
});
