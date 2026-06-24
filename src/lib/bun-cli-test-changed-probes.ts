/**
 * Runtime probes ported from oven-sh/bun `test/cli/test/test-changed.test.ts` (subset).
 */

import { join } from "path";
import { appendText, readText, writeText } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { cliProbe, withCliFixtureDir } from "./bun-cli-fixture.ts";

export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const CHANGED_FIXTURE = {
  "package.json": JSON.stringify({ name: "changed-test", type: "module" }),
  "src/helper.ts": `export const helper = () => 1;\n`,
  "src/util.ts": `import { helper } from "./helper";\nexport const util = () => helper() + 1;\n`,
  "a.test.ts": `import { test, expect } from "bun:test";\nimport { util } from "./src/util";\ntest("a", () => expect(util()).toBe(2));\n`,
  "src/other.ts": `export const other = () => 9;\n`,
  "b.test.ts": `import { test, expect } from "bun:test";\nimport { other } from "./src/other";\ntest("b", () => expect(other()).toBe(9));\n`,
  "c.test.ts": `import { test, expect } from "bun:test";\ntest("c", () => expect(1).toBe(1));\n`,
  "README.md": "hello\n",
} as const;

const TEST_NAMES = ["a.test.ts", "b.test.ts", "c.test.ts"] as const;

function gitEnv(dir: string): Record<string, string | undefined> {
  const config = join(dir, ".gitconfig-empty");
  writeText(config, "");
  return {
    ...Bun.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
}

function git(cwd: string, env: Record<string, string | undefined>, ...args: string[]): void {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}

function gitOptional(
  cwd: string,
  env: Record<string, string | undefined>,
  ...args: string[]
): void {
  Bun.spawnSync({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
}

function initRepo(cwd: string, env: Record<string, string | undefined>): void {
  git(cwd, env, "init", "-q");
  git(cwd, env, "config", "user.name", "Test");
  git(cwd, env, "config", "user.email", "test@example.com");
  gitOptional(cwd, env, "config", "commit.gpgsign", "false");
  git(cwd, env, "add", "-A");
  git(cwd, env, "commit", "-q", "-m", "initial");
}

async function runTestChanged(
  cwd: string,
  env: Record<string, string | undefined>,
  options: { ref?: string; junitPath?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; junit?: string }> {
  const args = options.ref ? ["test", `--changed=${options.ref}`] : ["test", "--changed"];
  if (options.junitPath) {
    args.push("--reporter=junit", `--reporter-outfile=${options.junitPath}`);
  }
  const proc = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  const junit =
    options.junitPath && (await Bun.file(options.junitPath).exists())
      ? readText(options.junitPath)
      : undefined;
  return { stdout, stderr, exitCode, junit };
}

/** Bun 1.4+ summary lines omit `file:` headers — junit reporter lists executed files. */
function ranFiles(output: string, junit: string | undefined, names: readonly string[]): string[] {
  if (junit) {
    return names
      .filter((n) => junit.includes(`name="${n}"`) || junit.includes(`file="${n}"`))
      .sort();
  }
  return names.filter((n) => output.includes(`${n}:`)).sort();
}

function combined(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`;
}

export async function runTestChangedContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  const noneOk = await withCliFixtureDir("changed-none", { ...CHANGED_FIXTURE }, async (dir) => {
    const env = gitEnv(dir);
    initRepo(dir, env);
    const result = await runTestChanged(dir, env);
    const out = combined(result);
    return (
      result.exitCode === 0 &&
      ranFiles(out, result.junit, TEST_NAMES).length === 0 &&
      out.includes("no changed files")
    );
  });
  probes.push(cliProbe("cli.test.changed.none", noneOk, noneOk ? "no changes" : "unexpected run"));

  const directOk = await withCliFixtureDir(
    "changed-direct",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "c.test.ts"), "// touched\n");
      const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-direct.xml") });
      const out = combined(result);
      return (
        result.exitCode === 0 && ranFiles(out, result.junit, TEST_NAMES).join() === "c.test.ts"
      );
    }
  );
  probes.push(
    cliProbe("cli.test.changed.direct", directOk, directOk ? "c.test.ts" : "wrong files")
  );

  const depOk = await withCliFixtureDir("changed-dep", { ...CHANGED_FIXTURE }, async (dir) => {
    const env = gitEnv(dir);
    initRepo(dir, env);
    appendText(join(dir, "src", "other.ts"), "// touched\n");
    const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-dep.xml") });
    const out = combined(result);
    return result.exitCode === 0 && ranFiles(out, result.junit, TEST_NAMES).join() === "b.test.ts";
  });
  probes.push(cliProbe("cli.test.changed.dep", depOk, depOk ? "b.test.ts" : "wrong files"));

  const unrelatedOk = await withCliFixtureDir(
    "changed-unrelated",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "README.md"), "more\n");
      const result = await runTestChanged(dir, env);
      const out = combined(result);
      return (
        result.exitCode === 0 &&
        ranFiles(out, result.junit, TEST_NAMES).length === 0 &&
        out.includes("no test files are affected")
      );
    }
  );
  probes.push(
    cliProbe(
      "cli.test.changed.unrelated",
      unrelatedOk,
      unrelatedOk ? "no affected" : "unexpected run"
    )
  );

  const noGitOk = await withCliFixtureDir(
    "changed-nogit",
    {
      "package.json": JSON.stringify({ name: "nogit" }),
      "only.test.ts": `import { test } from "bun:test";\ntest("only", () => {});\n`,
    },
    async (dir) => {
      const env = {
        ...gitEnv(dir),
        GIT_CEILING_DIRECTORIES: dir,
        GIT_DIR: join(dir, "no-such-git-dir"),
      };
      const result = await runTestChanged(dir, env);
      const out = combined(result).toLowerCase();
      return result.exitCode !== 0 && out.includes("git");
    }
  );
  probes.push(cliProbe("cli.test.changed.nogit", noGitOk, noGitOk ? "git error" : "unexpected ok"));

  const transitiveOk = await withCliFixtureDir(
    "changed-transitive",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "src", "helper.ts"), "// touched\n");
      const result = await runTestChanged(dir, env, {
        junitPath: join(dir, "changed-transitive.xml"),
      });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, TEST_NAMES).join() === "a.test.ts"
      );
    }
  );
  probes.push(
    cliProbe(
      "cli.test.changed.transitive",
      transitiveOk,
      transitiveOk ? "a.test.ts" : "wrong files"
    )
  );

  const stagedOk = await withCliFixtureDir(
    "changed-staged",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "src", "other.ts"), "// touched\n");
      git(dir, env, "add", "-A");
      const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-staged.xml") });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, TEST_NAMES).join() === "b.test.ts"
      );
    }
  );
  probes.push(
    cliProbe("cli.test.changed.staged", stagedOk, stagedOk ? "b.test.ts" : "wrong files")
  );

  const sharedOk = await withCliFixtureDir(
    "changed-shared",
    {
      "package.json": JSON.stringify({ name: "shared", type: "module" }),
      "shared.ts": `export const v = 1;\n`,
      "one.test.ts": `import { test, expect } from "bun:test";\nimport { v } from "./shared";\ntest("one", () => expect(v).toBe(1));\n`,
      "two.test.ts": `import { test, expect } from "bun:test";\nimport { v } from "./shared";\ntest("two", () => expect(v).toBe(1));\n`,
      "three.test.ts": `import { test, expect } from "bun:test";\ntest("three", () => expect(1).toBe(1));\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "shared.ts"), "// touched\n");
      const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-shared.xml") });
      const names = ["one.test.ts", "two.test.ts", "three.test.ts"] as const;
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, names).join() === "one.test.ts,two.test.ts"
      );
    }
  );
  probes.push(cliProbe("cli.test.changed.shared", sharedOk, sharedOk ? "one+two" : "wrong files"));

  const multiOk = await withCliFixtureDir("changed-multi", { ...CHANGED_FIXTURE }, async (dir) => {
    const env = gitEnv(dir);
    initRepo(dir, env);
    appendText(join(dir, "src", "helper.ts"), "// touched\n");
    appendText(join(dir, "src", "other.ts"), "// touched\n");
    const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-multi.xml") });
    return (
      result.exitCode === 0 &&
      ranFiles(combined(result), result.junit, TEST_NAMES).join() === "a.test.ts,b.test.ts"
    );
  });
  probes.push(cliProbe("cli.test.changed.multi", multiOk, multiOk ? "a+b" : "wrong files"));

  const untrackedOk = await withCliFixtureDir(
    "changed-untracked",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      writeText(
        join(dir, "new.test.ts"),
        `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`
      );
      const result = await runTestChanged(dir, env, {
        junitPath: join(dir, "changed-untracked.xml"),
      });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, [...TEST_NAMES, "new.test.ts"]).join() ===
          "new.test.ts"
      );
    }
  );
  probes.push(
    cliProbe("cli.test.changed.untracked", untrackedOk, untrackedOk ? "new.test.ts" : "wrong files")
  );

  const refOk = await withCliFixtureDir("changed-ref", { ...CHANGED_FIXTURE }, async (dir) => {
    const env = gitEnv(dir);
    initRepo(dir, env);
    appendText(join(dir, "src", "helper.ts"), "// v2\n");
    git(dir, env, "add", "-A");
    git(dir, env, "commit", "-q", "-m", "v2");
    const clean = await runTestChanged(dir, env);
    if (clean.exitCode !== 0 || ranFiles(combined(clean), clean.junit, TEST_NAMES).length !== 0) {
      return false;
    }
    const result = await runTestChanged(dir, env, {
      ref: "HEAD~1",
      junitPath: join(dir, "changed-ref.xml"),
    });
    return (
      result.exitCode === 0 &&
      ranFiles(combined(result), result.junit, TEST_NAMES).join() === "a.test.ts"
    );
  });
  probes.push(cliProbe("cli.test.changed.ref", refOk, refOk ? "HEAD~1" : "wrong files"));

  const refUntrackedOk = await withCliFixtureDir(
    "changed-ref-untracked",
    { ...CHANGED_FIXTURE },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "src", "helper.ts"), "// v2\n");
      git(dir, env, "add", "-A");
      git(dir, env, "commit", "-q", "-m", "v2");
      writeText(
        join(dir, "new.test.ts"),
        `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`
      );
      const result = await runTestChanged(dir, env, {
        ref: "HEAD~1",
        junitPath: join(dir, "changed-ref-untracked.xml"),
      });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, [...TEST_NAMES, "new.test.ts"]).join() ===
          "a.test.ts,new.test.ts"
      );
    }
  );
  probes.push(
    cliProbe(
      "cli.test.changed.ref-untracked",
      refUntrackedOk,
      refUntrackedOk ? "a+new" : "wrong files"
    )
  );

  const nmOk = await withCliFixtureDir(
    "changed-nm",
    {
      "package.json": JSON.stringify({ name: "nm", type: "module" }),
      "node_modules/fake-pkg/package.json": JSON.stringify({
        name: "fake-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
      "node_modules/fake-pkg/index.js": `module.exports = { value: 1 };\n`,
      "pkg.test.ts": `import { test, expect } from "bun:test";\nimport pkg from "fake-pkg";\ntest("pkg", () => expect(pkg.value).toBe(1));\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "node_modules", "fake-pkg", "index.js"), "// touched\n");
      const result = await runTestChanged(dir, env, { junitPath: join(dir, "changed-nm.xml") });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, ["pkg.test.ts"]).length === 0
      );
    }
  );
  probes.push(cliProbe("cli.test.changed.nm", nmOk, nmOk ? "nm ignored" : "unexpected run"));

  const subdirOk = await withCliFixtureDir(
    "changed-subdir",
    {
      "package.json": JSON.stringify({ name: "root" }),
      "app/package.json": JSON.stringify({ name: "app", type: "module" }),
      "app/dep.ts": `export const x = 1;\n`,
      "app/sub.test.ts": `import { test, expect } from "bun:test";\nimport { x } from "./dep";\ntest("sub", () => expect(x).toBe(1));\n`,
      "app/untouched.test.ts": `import { test, expect } from "bun:test";\ntest("untouched", () => expect(1).toBe(1));\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "app", "dep.ts"), "// touched\n");
      const result = await runTestChanged(join(dir, "app"), env, {
        junitPath: join(dir, "changed-subdir.xml"),
      });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, ["sub.test.ts", "untouched.test.ts"]).join() ===
          "sub.test.ts"
      );
    }
  );
  probes.push(
    cliProbe("cli.test.changed.subdir", subdirOk, subdirOk ? "sub.test.ts" : "wrong files")
  );

  const tsconfigPathsOk = await withCliFixtureDir(
    "changed-tsconfig-paths",
    {
      "package.json": JSON.stringify({ name: "aliasrepro", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
      }),
      "src/adder.ts": `export const add = (a: number, b: number) => a + b;\n`,
      "tests/alias.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "@/src/adder";\ntest("alias", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/relative.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "../src/adder";\ntest("relative", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/unrelated.test.ts": `import { test, expect } from "bun:test";\ntest("unrelated", () => expect(1).toBe(1));\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "src", "adder.ts"), "// touched\n");
      const result = await runTestChanged(dir, env, {
        junitPath: join(dir, "changed-tsconfig.xml"),
      });
      const names = [
        "tests/alias.test.ts",
        "tests/relative.test.ts",
        "tests/unrelated.test.ts",
      ] as const;
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, names).join() ===
          "tests/alias.test.ts,tests/relative.test.ts"
      );
    }
  );
  probes.push(
    cliProbe(
      "cli.test.changed.tsconfig-paths",
      tsconfigPathsOk,
      tsconfigPathsOk ? "alias+relative" : "wrong files"
    )
  );

  const parseErrOk = await withCliFixtureDir(
    "changed-parseerr",
    {
      "package.json": JSON.stringify({ name: "pe", type: "module" }),
      "good.ts": `export const g = 1;\n`,
      "good.test.ts": `import { test, expect } from "bun:test";\nimport { g } from "./good";\ntest("good", () => expect(g).toBe(1));\n`,
      "bad.test.ts": `import { test } from "bun:test";\nimport { nope } from "./does-not-exist";\ntest("bad", () => {});\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      appendText(join(dir, "good.ts"), "// touched\n");
      const result = await runTestChanged(dir, env, {
        junitPath: join(dir, "changed-parseerr.xml"),
      });
      const out = combined(result);
      return (
        result.exitCode === 0 &&
        ranFiles(out, result.junit, ["good.test.ts", "bad.test.ts"]).join() === "good.test.ts"
      );
    }
  );
  probes.push(
    cliProbe("cli.test.changed.parseerr", parseErrOk, parseErrOk ? "good only" : "wrong files")
  );

  const subdirUntrackedOk = await withCliFixtureDir(
    "changed-subdir-untracked",
    {
      "package.json": JSON.stringify({ name: "root" }),
      "app/package.json": JSON.stringify({ name: "app", type: "module" }),
      "app/base.test.ts": `import { test, expect } from "bun:test";\ntest("base", () => expect(1).toBe(1));\n`,
    },
    async (dir) => {
      const env = gitEnv(dir);
      initRepo(dir, env);
      writeText(
        join(dir, "app", "brand-new.test.ts"),
        `import { test, expect } from "bun:test";\ntest("brand-new", () => expect(1).toBe(1));\n`
      );
      const result = await runTestChanged(join(dir, "app"), env, {
        junitPath: join(dir, "changed-subdir-untracked.xml"),
      });
      return (
        result.exitCode === 0 &&
        ranFiles(combined(result), result.junit, ["base.test.ts", "brand-new.test.ts"]).join() ===
          "brand-new.test.ts"
      );
    }
  );
  probes.push(
    cliProbe(
      "cli.test.changed.subdir-untracked",
      subdirUntrackedOk,
      subdirUntrackedOk ? "brand-new" : "wrong files"
    )
  );

  return probes;
}
