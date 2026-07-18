import { pathExists } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";
import {
  desktopRuntimeDepsOk,
  provisionDesktopRuntimeDeps,
} from "../src/lib/desktop-runtime-deps.ts";

describe("desktop-runtime-deps", () => {
  test("provisionDesktopRuntimeDeps installs typescript into desktop root", async () => {
    const fakeHome = testTempDir("desktop-runtime-");
    try {
      await withEnv({ HOME: fakeHome }, async () => {
        const result = await provisionDesktopRuntimeDeps();
        expect(result.installed).toBe(true);
        expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
        expect(
          pathExists(join(fakeHome, ".kimi-code", "node_modules", "typescript", "package.json"))
        ).toBe(true);
        expect(
          pathExists(join(fakeHome, ".kimi-code", "node_modules", "ts-morph", "package.json"))
        ).toBe(true);
      });
    } finally {
      cleanupPath(fakeHome);
    }
  });

  test("desktopRuntimeDepsOk reports false when any template dep is missing", async () => {
    const fakeHome = testTempDir("desktop-runtime-");
    try {
      await withEnv({ HOME: fakeHome }, async () => {
        await provisionDesktopRuntimeDeps();
        expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
        const tsMorphPkg = join(fakeHome, ".kimi-code", "node_modules", "ts-morph", "package.json");
        cleanupPath(tsMorphPkg);
        expect(desktopRuntimeDepsOk(fakeHome)).toBe(false);
      });
    } finally {
      cleanupPath(fakeHome);
    }
  });
});
