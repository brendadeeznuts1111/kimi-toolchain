import { makeDir, pathExists, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";
import {
  desktopRoot,
  ensureDesktopLayout,
  resolveDesktopPaths,
  ROOT_TEMPLATES,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";

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
    expect(paths.templatesDst).toContain(".kimi-code/templates");
  });

  test("ROOT_TEMPLATES includes core docs", () => {
    expect(ROOT_TEMPLATES).toContain("AGENTS.md");
    expect(ROOT_TEMPLATES).toContain("CODE_REFERENCES.md");
    expect(ROOT_TEMPLATES).toContain("UNIFIED.md");
    expect(ROOT_TEMPLATES).toContain("canonical-references.json");
  });

  test("ensureDesktopLayout creates desktop dirs", () => {
    ensureDesktopLayout();
    const paths = resolveDesktopPaths(REPO_ROOT);
    expect(pathExists(paths.binDst)).toBe(true);
    expect(pathExists(paths.libDst)).toBe(true);
    expect(pathExists(paths.scriptsDst)).toBe(true);
  });

  test(
    "syncDesktop is idempotent on second run",
    async () => {
      try {
        await syncDesktop(REPO_ROOT, { force: true });
        const second = await syncDesktop(REPO_ROOT);
        expect(second.updated.length).toBe(0);
        expect(pathExists(join(pathsToolchain(REPO_ROOT), "tools", "kimi-doctor.ts"))).toBe(true);
      } catch (e: unknown) {
        // Sandbox may block writes to ~/.kimi-code/
        if (e instanceof Error && e.message?.includes("EPERM")) return;
        throw e;
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop force overwrites stale optional config",
    async () => {
      const tmpHome = join(REPO_ROOT, `.tmp-desktop-force-${Date.now()}`);
      makeDir(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        await syncDesktop(REPO_ROOT);
        await Bun.write(join(desktopRoot(), "bunfig.toml"), "# stale copy\n");
        const result = await syncDesktop(REPO_ROOT, { force: true });
        expect(result.updated).toContain("bunfig.toml");
        const text = await Bun.file(join(desktopRoot(), "bunfig.toml")).text();
        expect(text).not.toBe("# stale copy\n");
      } finally {
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop dry-run reports changes without writing",
    async () => {
      const tmpHome = join(REPO_ROOT, `.tmp-desktop-dry-run-${Date.now()}`);
      makeDir(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        await syncDesktop(REPO_ROOT, { force: true });
        const target = join(desktopRoot(), "lib", "r-score.ts");
        const stale = "// stale runtime copy\n";
        await Bun.write(target, stale);

        const result = await syncDesktop(REPO_ROOT, { dryRun: true });

        expect(result.updated).toContain("lib/r-score.ts");
        expect(await Bun.file(target).text()).toBe(stale);
      } finally {
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop removes orphaned tool files",
    async () => {
      const tmpHome = join(REPO_ROOT, `.tmp-desktop-orphan-${Date.now()}`);
      makeDir(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        await syncDesktop(REPO_ROOT, { force: true });
        const orphanPath = join(desktopRoot(), "tools", "kimi-utils.ts");
        await Bun.write(orphanPath, "// legacy orphan\n");
        const result = await syncDesktop(REPO_ROOT, { force: true });
        expect(result.removed).toContain("tools/kimi-utils.ts");
        expect(pathExists(orphanPath)).toBe(false);
      } finally {
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop copies optional config when desktop copy missing",
    async () => {
      const tmpHome = join(REPO_ROOT, `.tmp-desktop-${Date.now()}`);
      makeDir(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        const result = await syncDesktop(REPO_ROOT);
        expect(result.updated.some((u) => u === "bunfig.toml" || u.includes("bunfig"))).toBe(true);
        expect(pathExists(join(desktopRoot(), "bunfig.toml"))).toBe(true);
      } finally {
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );

  test(
    "syncDesktop copies scaffold templates",
    async () => {
      const tmpHome = join(REPO_ROOT, `.tmp-desktop-templates-${Date.now()}`);
      makeDir(tmpHome, { recursive: true });
      Bun.env.HOME = tmpHome;
      try {
        const result = await syncDesktop(REPO_ROOT, { force: true });
        expect(result.updated).toContain("templates/scaffold/oxfmtrc.json");
        expect(pathExists(join(desktopRoot(), "templates", "scaffold", "oxfmtrc.json"))).toBe(true);
      } finally {
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 15_000 }
  );
});

function pathsToolchain(repoRoot: string) {
  return resolveDesktopPaths(repoRoot).desktopRoot;
}
