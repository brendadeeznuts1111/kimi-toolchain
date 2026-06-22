import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, readText, writeText } from "../src/lib/bun-io.ts";
import {
  bunfigLiteralTildeCacheDir,
  collectRootHygieneItems,
  DEFAULT_PROFILE_OUTPUT_DIR,
  envLiteralTildeCacheMisconfig,
  expandInstallCacheDir,
  fixBunfigCacheMisconfig,
  isLiteralTildeCachePath,
  stripBunfigLiteralTildeCacheDir,
} from "../src/lib/root-hygiene.ts";
import { withEnv, withTempDir } from "./helpers.ts";

describe("root-hygiene", () => {
  test("isLiteralTildeCachePath detects unexpanded tilde", () => {
    expect(isLiteralTildeCachePath("~/.bun/install/cache")).toBe(true);
    expect(isLiteralTildeCachePath("/Users/x/.bun/install/cache")).toBe(false);
  });

  test("expandInstallCacheDir resolves home-relative paths", () => {
    expect(expandInstallCacheDir("~/.bun/install/cache", "/tmp/home")).toBe(
      join("/tmp/home", ".bun/install/cache")
    );
  });

  test("envLiteralTildeCacheMisconfig warns on tilde env", () => {
    withEnv({ BUN_INSTALL_CACHE_DIR: "~/.bun/install/cache" }, () => {
      expect(envLiteralTildeCacheMisconfig()).toContain("BUN_INSTALL_CACHE_DIR");
    });
  });

  test("bunfigLiteralTildeCacheDir flags tilde cache dir", () => {
    const text = `[install.cache]\ndir = "~/.bun/install/cache"\n`;
    expect(bunfigLiteralTildeCacheDir(text)).toBe(true);
  });

  test("stripBunfigLiteralTildeCacheDir removes literal tilde cache dir", () => {
    const text = `[install.cache]\ndir = "~/.bun/install/cache"\ndisable = false\n`;
    const stripped = stripBunfigLiteralTildeCacheDir(text);
    expect(stripped).not.toContain('dir = "~/.bun/install/cache"');
    expect(stripped).toContain("disable = false");
  });

  test("collectRootHygieneItems finds literal tilde directory with file count", () => {
    withTempDir("root-hygiene-", (dir) => {
      makeDir(join(dir, "~", ".bun", "install", "cache"), { recursive: true });
      writeText(join(dir, "~", ".bun", "install", "cache", "pkg"), "x");
      writeText(join(dir, "CPU.test.cpuprofile"), "{}");
      writeText(join(dir, "cli.bun-build"), "x");
      const items = collectRootHygieneItems(dir);
      const tilde = items.find((item) => item.kind === "literal-tilde-dir");
      const cpu = items.find((item) => item.kind === "cpuprofile");
      const bunBuild = items.find((item) => item.kind === "bun-build");
      expect(tilde?.fileCount).toBe(1);
      expect(cpu?.fileCount).toBe(1);
      expect(bunBuild?.removePaths).toEqual(["cli.bun-build"]);
    });
  });

  test("DEFAULT_PROFILE_OUTPUT_DIR points under .kimi-artifacts", () => {
    expect(DEFAULT_PROFILE_OUTPUT_DIR).toBe(".kimi-artifacts/profiles");
  });

  test("collectRootHygieneItems groups bun-build artifacts", () => {
    withTempDir("root-hygiene-build-", (dir) => {
      writeText(join(dir, ".abc-00000000.bun-build"), "bin");
      writeText(join(dir, "out.bun-build"), "bin");
      const items = collectRootHygieneItems(dir);
      const builds = items.find((item) => item.kind === "bun-build");
      expect(builds?.fileCount).toBe(2);
      expect(builds?.removePaths?.length).toBe(2);
    });
  });

  test("stripBunfigLiteralTildeCacheDir removes tilde dir line", () => {
    const before = `[install.cache]\ndir = "~/.bun/install/cache"\ndisable = false\n`;
    const after = stripBunfigLiteralTildeCacheDir(before);
    expect(bunfigLiteralTildeCacheDir(after)).toBe(false);
    expect(after).toContain("disable = false");
  });

  test("fixBunfigCacheMisconfig patches project bunfig", () => {
    withTempDir("root-hygiene-bunfig-", (dir) => {
      const bunfig = join(dir, "bunfig.toml");
      writeText(bunfig, `[install.cache]\ndir = "~/.bun/install/cache"\ndisable = false\n`);
      expect(fixBunfigCacheMisconfig(dir)).toBe(true);
      expect(bunfigLiteralTildeCacheDir(readText(bunfig))).toBe(false);
    });
  });
});
