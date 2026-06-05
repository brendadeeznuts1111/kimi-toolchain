import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  desktopRoot,
  ensureDesktopLayout,
  resolveDesktopPaths,
  ROOT_TEMPLATES,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("desktop-sync", () => {
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
  });

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

  test("syncDesktop copies optional config when desktop copy missing", async () => {
    const tmpHome = join(REPO_ROOT, `.tmp-desktop-${Date.now()}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
    try {
      const result = await syncDesktop(REPO_ROOT);
      expect(result.updated.some((u) => u === "bunfig.toml" || u.includes("bunfig"))).toBe(true);
      expect(existsSync(join(desktopRoot(), "bunfig.toml"))).toBe(true);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

function pathsToolchain(repoRoot: string) {
  return resolveDesktopPaths(repoRoot).desktopRoot;
}
