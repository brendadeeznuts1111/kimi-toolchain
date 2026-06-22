import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import {
  hashFileSet,
  isFileSetSubset,
  readScopedTestCache,
  scopedTestCachePath,
  shouldSkipTestFastFromScopedCache,
  writeScopedTestCache,
} from "../src/lib/scoped-test-cache.ts";
import { GIT_LOCAL_ENV_KEYS } from "../src/lib/tool-runner.ts";

const GIT_LOCAL_ENV_KEY_SET = new Set<string>(GIT_LOCAL_ENV_KEYS);

function scrubbedGitFixtureEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !GIT_LOCAL_ENV_KEY_SET.has(entry[0])
    )
  );
}

async function runFixtureGit(projectRoot: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: projectRoot,
    env: scrubbedGitFixtureEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  expect({ args, stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
}

describe("scoped-test-cache", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = testTempDir("scoped-test-cache-");
    await runFixtureGit(projectDir, ["init"]);
    await runFixtureGit(projectDir, ["config", "user.email", "test@example.com"]);
    await runFixtureGit(projectDir, ["config", "user.name", "Test"]);
    ensureTestDir(join(projectDir, "src"));
    await Bun.write(join(projectDir, "src/foo.ts"), "export const x = 1;\n");
    await runFixtureGit(projectDir, ["add", "src/foo.ts"]);
    await runFixtureGit(projectDir, ["commit", "-m", "init"]);
  });

  afterEach(() => {
    cleanupPath(projectDir);
  });

  test("write and read round-trip", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts", "test/foo.unit.test.ts"], "main");
    const cache = await readScopedTestCache(projectDir);
    expect(cache?.files).toEqual(["src/foo.ts", "test/foo.unit.test.ts"]);
    expect(cache?.baseRef).toBe("main");
    expect(cache?.filesHash).toBe(hashFileSet(["src/foo.ts", "test/foo.unit.test.ts"]));
  });

  test("shouldSkip when staged is subset of cached files at HEAD", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts", "test/a.unit.test.ts"], "main");
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts"])).toBe(true);
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts", "src/new.ts"])).toBe(
      false
    );
  });

  test("shouldSkip false when HEAD changes", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts"], "main");
    await Bun.write(join(projectDir, "src/bar.ts"), "export const y = 2;\n");
    await runFixtureGit(projectDir, ["add", "src/bar.ts"]);
    await runFixtureGit(projectDir, ["commit", "-m", "second"]);
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts"])).toBe(false);
  });

  test("isFileSetSubset handles empty staged", () => {
    expect(isFileSetSubset([], ["src/a.ts"])).toBe(true);
    expect(isFileSetSubset(["src/a.ts"], [])).toBe(false);
  });

  test("cache file lives under .kimi", () => {
    expect(scopedTestCachePath(projectDir)).toContain(".kimi/.last-good-scoped-gates");
  });
});
