import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  bunfigLiteralTildeCacheDir,
  collectRootHygieneItems,
  DEFAULT_PROFILE_OUTPUT_DIR,
  envLiteralTildeCacheMisconfig,
  expandInstallCacheDir,
  isLiteralTildeCachePath,
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

  test("collectRootHygieneItems finds literal tilde directory with file count", () => {
    withTempDir("root-hygiene-", (dir) => {
      makeDir(join(dir, "~", ".bun", "install", "cache"), { recursive: true });
      writeText(join(dir, "~", ".bun", "install", "cache", "pkg"), "x");
      writeText(join(dir, "CPU.test.cpuprofile"), "{}");
      const items = collectRootHygieneItems(dir);
      const tilde = items.find((item) => item.kind === "literal-tilde-dir");
      const cpu = items.find((item) => item.kind === "cpuprofile");
      expect(tilde?.fileCount).toBe(1);
      expect(cpu?.fileCount).toBe(1);
    });
  });

  test("DEFAULT_PROFILE_OUTPUT_DIR points under .kimi-artifacts", () => {
    expect(DEFAULT_PROFILE_OUTPUT_DIR).toBe(".kimi-artifacts/profiles");
  });
});
