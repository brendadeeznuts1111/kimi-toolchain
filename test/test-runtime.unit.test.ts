import { describe, expect, test } from "bun:test";
import {
  TEST_TIER_ORDER,
  TEST_TIER_SPECS,
  TEST_ENV_FILE,
  buildTestRunnerEnv,
  bunTestArgsForTier,
  bunTestArgsForChanged,
  mergeBunTestInvocationArgs,
  parseForwardedBunTestArgs,
  warnIfNodeEnvNotTest,
  resetTestRuntimeWarningsForTests,
} from "../src/lib/test-runtime.ts";
import { testTempDir, withClearedEnv, withEnv } from "./helpers.ts";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { join } from "path";

describe("test-runtime", () => {
  describe("Bun NODE_ENV contract", () => {
    // https://bun.com/docs/test/runtime-behavior#node_env
    test("with kimi preload: NODE_ENV is test", () => {
      expect(process.env.NODE_ENV).toBe("test");
    });

    test("native bun test: explicit NODE_ENV=development is preserved without preload", async () => {
      const dir = testTempDir("bun-node-env-native-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "node-env.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("probe", () => {
  if (process.env.NODE_ENV !== "development") process.exit(2);
  expect(process.env.NODE_ENV).toBe("development");
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");

      const proc = Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "development" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      expect(code).toBe(0);
    }, 15_000);

    test("kimi wrappers override explicit NODE_ENV before spawn", () => {
      withEnv({ NODE_ENV: "development" }, () => {
        const env = buildTestRunnerEnv({}, "NODE_ENV=development bun test");
        expect(env.NODE_ENV).toBe("test");
      });
    });
  });

  test("warnIfNodeEnvNotTest warns once when NODE_ENV is not test", () => {
    resetTestRuntimeWarningsForTests();
    withClearedEnv(["NODE_ENV"], () => {
      withEnv({ NODE_ENV: "development" }, () => {
        const lines: string[] = [];
        const prior = console.warn;
        console.warn = (message: string) => {
          lines.push(message);
        };
        try {
          warnIfNodeEnvNotTest("test");
          warnIfNodeEnvNotTest("test");
        } finally {
          console.warn = prior;
        }
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('NODE_ENV was "development"');
        expect(lines[0]).toContain("[test]");
      });
    });
  });

  test("buildTestRunnerEnv forces NODE_ENV=test", () => {
    const env = buildTestRunnerEnv({ NODE_ENV: "development" });
    expect(env.NODE_ENV).toBe("test");
  });

  test("buildTestRunnerEnv defaults TZ to UTC", () => {
    const env = buildTestRunnerEnv({});
    expect(env.TZ).toBe("Etc/UTC");
  });

  test("tier order runs unit before integration and smoke", () => {
    expect(TEST_TIER_ORDER).toEqual(["unit", "integration", "smoke"]);
  });

  test("unit tier uses parallel isolate args", () => {
    const args = bunTestArgsForTier(TEST_TIER_SPECS.unit);
    expect(args).toContain("--isolate");
    expect(args).toContain("--parallel");
    expect(args[0]).toBe("test");
  });

  describe("Bun CLI flags integration", () => {
    test("parseForwardedBunTestArgs reads args after --", () => {
      expect(parseForwardedBunTestArgs(["--push", "--", "--smol", "--inspect"])).toEqual([
        "--smol",
        "--inspect",
      ]);
    });

    test("parseForwardedBunTestArgs picks known flags without --", () => {
      expect(parseForwardedBunTestArgs(["--smol", "--frozen-lockfile"])).toEqual([
        "--smol",
        "--frozen-lockfile",
      ]);
    });

    test("mergeBunTestInvocationArgs appends .env.test when present", () => {
      const dir = testTempDir("test-env-file-");
      makeDir(dir, { recursive: true });
      writeText(join(dir, TEST_ENV_FILE), "KIMI_TEST_FLAG=1\n");
      const merged = mergeBunTestInvocationArgs(["test", "--isolate"], dir, []);
      expect(merged).toContain("--env-file");
      expect(merged).toContain(TEST_ENV_FILE);
    });

    test("bunTestArgsForChanged includes isolate and parallel", () => {
      const args = bunTestArgsForChanged("HEAD");
      expect(args).toContain("--isolate");
      expect(args).toContain("--parallel");
      expect(args.some((arg) => arg.startsWith("--changed="))).toBe(true);
    });
  });
});