import { describe, expect, test } from "bun:test";
import { compileBinary } from "../src/lib/compile-target.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { formatVersionTable } from "../src/lib/version.ts";
import { REPO_ROOT, withTempDir, writeText } from "./helpers.ts";

describe("version", () => {
  test("Bun.semver.order returns -1, 0, 1", () => {
    expect(Bun.semver.order("1.0.0", "1.0.1")).toBe(-1);
    expect(Bun.semver.order("1.2.0", "1.1.9")).toBe(1);
    expect(Bun.semver.order("1.0.0", "1.0.0")).toBe(0);
  });

  test("Bun.semver.order handles pre-release tags", () => {
    expect(Bun.semver.order("0.18.0-canary.1", "0.18.0")).toBe(-1);
    expect(Bun.semver.order("1.0.0", "1.0.0-beta")).toBe(1);
  });

  test("Bun.semver.satisfies checks ranges", () => {
    expect(Bun.semver.satisfies("1.5.0", ">=1.0.0")).toBe(true);
    expect(Bun.semver.satisfies("0.9.0", ">=1.0.0")).toBe(false);
  });

  test("Bun.semver.order throws on invalid version for validation", () => {
    // Valid semver
    expect(() => Bun.semver.order("1.0.0", "0.0.0")).not.toThrow();
    expect(() => Bun.semver.order("0.18.0-canary.1", "0.0.0")).not.toThrow();
    // Invalid semver throws
    expect(() => Bun.semver.order("garbage", "0.0.0")).toThrow();
  });

  test("version.ts avoids node:fs/promises for atomic manifest writes", async () => {
    const text = await Bun.file(new URL("../src/lib/version.ts", import.meta.url)).text();
    expect(text).not.toContain('from "node:fs/promises"');
    expect(text).toContain("movePath");
  });

  test("formatVersionTable returns string with headers", () => {
    const table = formatVersionTable({
      toolchain: "1.0.0",
      name: "kimi-toolchain",
      mcpBridge: "1.0.0",
      desktop: null,
      gitHead: "abc123",
      dirty: false,
      manifestPath: "/tmp/manifest.json",
      buildTime: null,
      gitCommit: null,
      buildChannel: null,
    });
    expect(table).toContain("Toolchain");
    expect(table).toContain("1.0.0");
  });

  test("compiled binary receives build metadata defines", async () => {
    await withTempDir("version-compile-", async (dir) => {
      const entry = `${dir}/meta.ts`;
      const out = `${dir}/meta`;
      const versionModule = `${REPO_ROOT}/src/lib/version.ts`;
      writeText(
        entry,
        `import { BUILD_CHANNEL, BUILD_TIME, GIT_COMMIT, TOOLCHAIN_VERSION } from "${versionModule}";\n` +
          `console.log(JSON.stringify({ version: TOOLCHAIN_VERSION, channel: BUILD_CHANNEL, time: BUILD_TIME, commit: GIT_COMMIT }));\n`
      );

      const result = await compileBinary({
        entryPoint: entry,
        outfile: out,
        define: {
          KIMI_BUILD_VERSION: '"9.9.9"',
          KIMI_BUILD_CHANNEL: '"release"',
          KIMI_BUILD_TIME: '"2024-01-15T10:30:00Z"',
          KIMI_GIT_COMMIT: '"abc123def"',
        },
        cwd: dir,
      });

      expect(result.ok).toBe(true);

      const proc = Bun.spawn([out], { stdout: "pipe", stderr: "pipe" });
      const stdout = await readableStreamToText(proc.stdout);
      await proc.exited;
      expect(proc.exitCode).toBe(0);

      const parsed = JSON.parse(stdout) as {
        version: string;
        channel: string;
        time: string;
        commit: string;
      };
      expect(parsed.version).toBe("9.9.9");
      expect(parsed.channel).toBe("release");
      expect(parsed.time).toBe("2024-01-15T10:30:00Z");
      expect(parsed.commit).toBe("abc123def");
    });
  }, 60_000);
});
