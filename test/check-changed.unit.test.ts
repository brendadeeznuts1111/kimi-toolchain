import { describe, expect, test } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import {
  changedIncludesTypeScript,
  filterFormatPaths,
  filterLintPaths,
  filterRelatedUnitTests,
  formatChangedOnlyBanner,
  formatChangedOnlyEmptyWarning,
  resolveChangedContext,
} from "../src/lib/check-changed.ts";
import type { CheckOptions } from "../src/lib/check-types.ts";

const changedOnlyBase: Omit<CheckOptions, "changedOnly"> = {
  dryRun: false,
  fast: true,
  staged: false,
  verbose: false,
  timeoutMs: 1500,
  base: "main",
  baseExplicit: false,
  failFast: false,
  jsonSummary: false,
  skipTests: false,
  watch: false,
  watchTests: false,
  cacheResults: false,
  noCache: false,
};

describe("check-changed", () => {
  test("filterFormatPaths keeps repo format roots only", () => {
    expect(
      filterFormatPaths(["src/lib/foo.ts", "README.md", "scripts/check.ts", "random.txt"])
    ).toEqual(["src/lib/foo.ts", "scripts/check.ts"]);
  });

  test("changedIncludesTypeScript detects ts/tsx", () => {
    expect(changedIncludesTypeScript(["README.md"])).toBe(false);
    expect(changedIncludesTypeScript(["src/foo.ts", "web/app.tsx"])).toBe(true);
  });

  test("filterLintPaths keeps JS/TS sources", () => {
    expect(filterLintPaths(["src/a.ts", "docs/foo.md", "scripts/b.js"])).toEqual([
      "src/a.ts",
      "scripts/b.js",
    ]);
  });

  test("filterRelatedUnitTests maps changed module to unit test file", () => {
    const related = filterRelatedUnitTests(["src/lib/gate-runner.ts"]);
    expect(related.some((path) => path.includes("gate-runner"))).toBe(true);
  });

  test("formatChangedOnlyBanner summarizes scope", () => {
    expect(formatChangedOnlyBanner(["src/a.ts"], "main→origin/main")).toContain("1 changed");
    expect(formatChangedOnlyBanner(["src/a.ts"], "main→origin/main")).toContain("origin/main");
  });

  test("formatChangedOnlyEmptyWarning mentions hook cache", () => {
    expect(formatChangedOnlyEmptyWarning("main")).toContain("scoped hook cache");
  });

  test("resolveChangedContext falls back to origin/main when main has no diff", async () => {
    const projectDir = testTempDir("check-changed-fallback-");
    try {
      await $`git init -b main`.cwd(projectDir).nothrow().quiet();
      await $`git config user.email test@example.com`.cwd(projectDir).nothrow().quiet();
      await $`git config user.name Test`.cwd(projectDir).nothrow().quiet();
      ensureTestDir(join(projectDir, "src"));
      await Bun.write(join(projectDir, "src/initial.ts"), "export const a = 1;\n");
      await $`git add src/initial.ts`.cwd(projectDir).nothrow().quiet();
      await $`git commit -m init`.cwd(projectDir).nothrow().quiet();
      await $`git update-ref refs/remotes/origin/main HEAD`.cwd(projectDir).nothrow().quiet();

      await Bun.write(join(projectDir, "src/next.ts"), "export const b = 2;\n");
      await $`git add src/next.ts`.cwd(projectDir).nothrow().quiet();
      await $`git commit -m second`.cwd(projectDir).nothrow().quiet();

      const ctx = await resolveChangedContext(projectDir, {
        ...changedOnlyBase,
        changedOnly: true,
      });
      expect(ctx.changedFiles?.length).toBe(1);
      expect(ctx.changedFiles?.[0]).toBe("src/next.ts");
      expect(ctx.baseLabel).toContain("origin/main");
    } finally {
      cleanupPath(projectDir);
    }
  });

  test("resolveChangedContext respects baseExplicit and skips fallback", async () => {
    const projectDir = testTempDir("check-changed-explicit-");
    try {
      await $`git init -b main`.cwd(projectDir).nothrow().quiet();
      await $`git config user.email test@example.com`.cwd(projectDir).nothrow().quiet();
      await $`git config user.name Test`.cwd(projectDir).nothrow().quiet();
      ensureTestDir(join(projectDir, "src"));
      await Bun.write(join(projectDir, "src/initial.ts"), "export const a = 1;\n");
      await $`git add src/initial.ts`.cwd(projectDir).nothrow().quiet();
      await $`git commit -m init`.cwd(projectDir).nothrow().quiet();
      await $`git update-ref refs/remotes/origin/main HEAD`.cwd(projectDir).nothrow().quiet();

      await Bun.write(join(projectDir, "src/next.ts"), "export const b = 2;\n");
      await $`git add src/next.ts`.cwd(projectDir).nothrow().quiet();
      await $`git commit -m second`.cwd(projectDir).nothrow().quiet();

      const ctx = await resolveChangedContext(projectDir, {
        ...changedOnlyBase,
        changedOnly: true,
        baseExplicit: true,
      });
      expect(ctx.changedFiles).toEqual([]);
      expect(ctx.baseLabel).toBe("main");
    } finally {
      cleanupPath(projectDir);
    }
  });
});
