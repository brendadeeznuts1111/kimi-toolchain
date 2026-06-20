import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  changedIncludesTypeScript,
  filterFormatPaths,
  filterLintPaths,
  formatChangedOnlyBanner,
  formatChangedOnlyEmptyWarning,
  resolveChangedContext,
} from "../src/lib/check-changed.ts";
import type { CheckOptions } from "../src/lib/check-types.ts";

function gitSpawnEnv(): Record<string, string> {
  const env = { ...Bun.env } as Record<string, string>;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

async function gitOk(projectDir: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-C", projectDir, ...args], {
    cwd: projectDir,
    env: gitSpawnEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await readableStreamToText(proc.stderr);
    throw new Error(`git -C ${projectDir} ${args.join(" ")} failed (${exitCode}): ${stderr}`);
  }
}

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

  test("formatChangedOnlyBanner summarizes scope", () => {
    expect(formatChangedOnlyBanner(["src/a.ts"], "main→origin/main")).toContain("1 changed");
    expect(formatChangedOnlyBanner(["src/a.ts"], "main→origin/main")).toContain("origin/main");
  });

  test("formatChangedOnlyEmptyWarning mentions hook cache", () => {
    expect(formatChangedOnlyEmptyWarning("main")).toContain("scoped hook cache");
  });

  test(
    "resolveChangedContext falls back to origin/main when main has no diff",
    async () => {
      const projectDir = testTempDir("check-changed-fallback-");
      try {
        await gitOk(projectDir, "init", "-b", "main");
        await gitOk(projectDir, "config", "user.email", "test@example.com");
        await gitOk(projectDir, "config", "user.name", "Test");
        ensureTestDir(join(projectDir, "src"));
        await Bun.write(join(projectDir, "src/initial.ts"), "export const a = 1;\n");
        await gitOk(projectDir, "add", "src/initial.ts");
        await gitOk(projectDir, "commit", "--no-verify", "-m", "init");
        await gitOk(projectDir, "update-ref", "refs/remotes/origin/main", "HEAD");

        await Bun.write(join(projectDir, "src/next.ts"), "export const b = 2;\n");
        await gitOk(projectDir, "add", "src/next.ts");
        await gitOk(projectDir, "commit", "--no-verify", "-m", "second");

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
    },
    { timeout: 15_000 }
  );

  test(
    "resolveChangedContext respects baseExplicit and skips fallback",
    async () => {
      const projectDir = testTempDir("check-changed-explicit-");
      try {
        await gitOk(projectDir, "init", "-b", "main");
        await gitOk(projectDir, "config", "user.email", "test@example.com");
        await gitOk(projectDir, "config", "user.name", "Test");
        ensureTestDir(join(projectDir, "src"));
        await Bun.write(join(projectDir, "src/initial.ts"), "export const a = 1;\n");
        await gitOk(projectDir, "add", "src/initial.ts");
        await gitOk(projectDir, "commit", "--no-verify", "-m", "init");
        await gitOk(projectDir, "update-ref", "refs/remotes/origin/main", "HEAD");

        await Bun.write(join(projectDir, "src/next.ts"), "export const b = 2;\n");
        await gitOk(projectDir, "add", "src/next.ts");
        await gitOk(projectDir, "commit", "--no-verify", "-m", "second");

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
    },
    { timeout: 15_000 }
  );
});
