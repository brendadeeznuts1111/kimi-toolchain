import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  desktopRuntimeDepsOk,
  provisionDesktopRuntimeDeps,
} from "../src/lib/desktop-runtime-deps.ts";

describe("desktop-runtime-deps", () => {
  const previousHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = previousHome;
  });

  test("provisionDesktopRuntimeDeps installs typescript into desktop root", async () => {
    const fakeHome = join(tmpdir(), `desktop-runtime-deps-${Bun.randomUUIDv7()}`);
    process.env.HOME = fakeHome;

    const result = await provisionDesktopRuntimeDeps();
    expect(result.installed).toBe(true);
    expect(desktopRuntimeDepsOk(fakeHome)).toBe(true);
    expect(
      existsSync(join(fakeHome, ".kimi-code", "node_modules", "typescript", "package.json"))
    ).toBe(true);

    rmSync(fakeHome, { recursive: true, force: true });
  });
});
