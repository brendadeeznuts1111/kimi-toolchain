import { describe, expect, test } from "bun:test";
import { ensureWorktreeClean } from "../src/lib/git-helpers.ts";
import { testTempDir, cleanupPath } from "./helpers.ts";
import { $ } from "bun";

describe("git-helpers", () => {
  describe("ensureWorktreeClean", () => {
    test("returns wasStale=false when core.worktree is not set", async () => {
      const dir = testTempDir("wt-clean-");
      try {
        await $`git init`.cwd(dir).nothrow().quiet();
        const result = await ensureWorktreeClean(dir);
        expect(result.wasStale).toBe(false);
        expect(result.actualRoot).toBeTruthy();
        expect(result.stalePath).toBeUndefined();
      } finally {
        cleanupPath(dir);
      }
    });

    test("detects and repairs stale core.worktree pointing to a temp dir", async () => {
      const dir = testTempDir("wt-stale-");
      const fakeDir = testTempDir("wt-fake-target-");
      try {
        await $`git init`.cwd(dir).nothrow().quiet();
        // Set core.worktree to a wrong path
        await $`git config core.worktree ${fakeDir}`.cwd(dir).nothrow().quiet();

        // Verify it's set
        const checkBefore = await $`git config --local core.worktree`.cwd(dir).nothrow().quiet();
        expect(checkBefore.stdout.toString().trim()).toBe(fakeDir);

        const result = await ensureWorktreeClean(dir);
        expect(result.wasStale).toBe(true);
        expect(result.stalePath).toBe(fakeDir);

        // Verify it's now unset
        const checkAfter = await $`git config --local core.worktree`.cwd(dir).nothrow().quiet();
        expect(checkAfter.exitCode).not.toBe(0);
      } finally {
        cleanupPath(dir);
        cleanupPath(fakeDir);
      }
    });

    test("leaves core.worktree alone when it matches the actual root", async () => {
      const dir = testTempDir("wt-match-");
      try {
        await $`git init`.cwd(dir).nothrow().quiet();
        // Set core.worktree to the actual repo dir
        await $`git config core.worktree ${dir}`.cwd(dir).nothrow().quiet();

        const result = await ensureWorktreeClean(dir);
        expect(result.wasStale).toBe(false);
      } finally {
        cleanupPath(dir);
      }
    });
  });
});
