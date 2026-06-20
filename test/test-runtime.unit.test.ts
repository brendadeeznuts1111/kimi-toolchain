import { describe, expect, test } from "bun:test";
import {
  BUN_TEST_EXIT,
  BUN_TEST_EXPLICIT_IMPORT,
  BUN_TEST_GLOBAL_NAMES,
  BUN_TEST_IMPORT_NAMES,
  describeBunTestExitCode,
  isBunTestFailureExit,
  isUnhandledErrorExitCode,
  TEST_TIER_ORDER,
  TEST_TIER_SPECS,
  TEST_ENV_FILE,
  buildTestRunnerEnv,
  bunTestArgsForTier,
  bunTestArgsForChanged,
  installBuildConstantGlobals,
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

  describe("Bun global variables contract", () => {
    // https://bun.com/docs/test/runtime-behavior#global-variables
    test("documents bun:test globals Bun injects without import", () => {
      expect(BUN_TEST_GLOBAL_NAMES).toEqual([
        "test",
        "it",
        "describe",
        "expect",
        "beforeAll",
        "beforeEach",
        "afterAll",
        "afterEach",
        "jest",
        "vi",
      ]);
    });

    test("native bun test: bun:test globals work without import", async () => {
      const dir = testTempDir("bun-globals-native-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "globals.probe.test.ts");
      writeText(
        testPath,
        `test("global test function", () => {
  expect(true).toBe(true);
});
describe("global describe", () => {
  it("global it function", () => {
    expect(typeof jest.fn).toBe("function");
    expect(typeof vi.fn).toBe("function");
  });
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");

      const proc = Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      expect(code).toBe(0);
    }, 15_000);

    test("installBuildConstantGlobals mirrors bunfig define onto globalThis", () => {
      const dir = testTempDir("define-globals-");
      const key = "KIMI_TEST_RUNTIME_PROBE";
      makeDir(dir, { recursive: true });
      writeText(join(dir, "bunfig.toml"), `[define]\n${key} = '"probe-value"'\n`);
      const globals = globalThis as Record<string, unknown>;
      const priorProbe = globals.KIMI_TUNING_SET_VERSION;
      const priorTest = globals[key];
      delete globals.KIMI_TUNING_SET_VERSION;
      delete globals[key];
      try {
        installBuildConstantGlobals(dir);
        expect(globals[key]).toBe("probe-value");
      } finally {
        if (priorProbe === undefined) delete globals.KIMI_TUNING_SET_VERSION;
        else globals.KIMI_TUNING_SET_VERSION = priorProbe;
        if (priorTest === undefined) delete globals[key];
        else globals[key] = priorTest;
      }
    });
  });

  describe("Bun process integration", () => {
    // https://bun.com/docs/test/runtime-behavior#process-integration
    test("documents bun:test explicit import line and import names", () => {
      expect(BUN_TEST_IMPORT_NAMES).toEqual(BUN_TEST_GLOBAL_NAMES);
      expect(BUN_TEST_EXPLICIT_IMPORT).toContain('from "bun:test"');
      for (const name of BUN_TEST_IMPORT_NAMES) {
        expect(BUN_TEST_EXPLICIT_IMPORT).toContain(name);
      }
    });

    test("describeBunTestExitCode maps Bun exit codes", () => {
      expect(describeBunTestExitCode(0)).toBe("all passed");
      expect(describeBunTestExitCode(1)).toBe("failures or runner errors");
      expect(describeBunTestExitCode(2)).toBe("unhandled errors (2)");
      expect(isBunTestFailureExit(1)).toBe(true);
      expect(isBunTestFailureExit(0)).toBe(false);
      expect(isUnhandledErrorExitCode(2)).toBe(true);
      expect(isUnhandledErrorExitCode(1)).toBe(false);
    });

    test("buildTestRunnerEnv preserves CI detection env", () => {
      withEnv({ CI: "true", GITHUB_ACTIONS: "true" }, () => {
        const env = buildTestRunnerEnv({});
        expect(env.CI).toBe("true");
        expect(env.GITHUB_ACTIONS).toBe("true");
        expect(env.NODE_ENV).toBe("test");
      });
    });

    test("native bun test: exit 0 when all tests pass", async () => {
      const dir = testTempDir("bun-exit-ok-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "exit-ok.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: exit 1 on assertion failure", async () => {
      const dir = testTempDir("bun-exit-fail-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "exit-fail.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("fails", () => {
  expect(1).toBe(2);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.failures);
    }, 15_000);

    test("native bun test: non-zero exit on unhandled rejection", async () => {
      const dir = testTempDir("bun-exit-unhandled-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "exit-unhandled.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});
Promise.reject(new Error("Unhandled rejection"));`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(isBunTestFailureExit(code)).toBe(true);
    }, 15_000);
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