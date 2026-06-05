import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import {
  ensureDesktopLayout,
  resolveDesktopPaths,
  ROOT_TEMPLATES,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("desktop-sync", () => {
  test("resolveDesktopPaths maps repo to desktop targets", () => {
    const paths = resolveDesktopPaths(REPO_ROOT);
    expect(paths.binSrc).toContain("src/bin");
    expect(paths.binDst).toContain(".kimi-code/tools");
    expect(paths.scriptsSrc).toContain("scripts");
  });

  test("ROOT_TEMPLATES includes core docs", () => {
    expect(ROOT_TEMPLATES).toContain("AGENTS.md");
    expect(ROOT_TEMPLATES).toContain("UNIFIED.md");
  });

  test("ensureDesktopLayout creates desktop dirs", () => {
    ensureDesktopLayout();
    const paths = resolveDesktopPaths(REPO_ROOT);
    expect(existsSync(paths.binDst)).toBe(true);
    expect(existsSync(paths.libDst)).toBe(true);
    expect(existsSync(paths.scriptsDst)).toBe(true);
  });

  test("syncDesktop is idempotent on second run", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const second = await syncDesktop(REPO_ROOT);
    expect(second.updated.length).toBe(0);
    expect(existsSync(join(pathsToolchain(REPO_ROOT), "tools", "kimi-doctor.ts"))).toBe(true);
  });
});

function pathsToolchain(repoRoot: string) {
  return resolveDesktopPaths(repoRoot).desktopRoot;
}
