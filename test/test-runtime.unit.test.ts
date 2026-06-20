import { describe, expect, test } from "bun:test";
import {
  BUN_TEST_DETECTION_ENV_KEYS,
  BUN_TEST_EXIT,
  BUN_TEST_EXPLICIT_IMPORT,
  BUN_TEST_GLOBAL_NAMES,
  BUN_TEST_IMPORT_NAMES,
  BUN_TEST_ISOLATION,
  BUN_TEST_ISOLATION_AFTER_EACH_IMPORT,
  BUN_TEST_MEMORY,
  BUN_TEST_PERFORMANCE,
  BUN_TEST_SIGNALS,
  BUN_TEST_DEBUG,
  BUN_TEST_DEBUG_FLAGS,
  BUN_TEST_INSTALL,
  BUN_TEST_INSTALL_FLAGS,
  BUN_TEST_MODULE_LOADING,
  BUN_TEST_MODULE_LOADING_VALUE_FLAGS,
  BUN_TEST_WATCH,
  bunTestDebugArgs,
  readBunfigTestPreloadPaths,
  bunTestArgsIncludeFlag,
  bunTestWatchArgs,
  isBunTestDebugFlag,
  isBunTestInstallFlag,
  parseForwardedDebugFlags,
  parseForwardedInstallFlags,
  isBunTestHotMode,
  isBunTestWatchMode,
  describeBunTestExitCode,
  isBunCiDetectionEnv,
  isBunTestFailureExit,
  isUnhandledErrorExitCode,
  preservesBunDetectionEnv,
  shouldEmitCiTestReporter,
  TEST_TIER_ORDER,
  TEST_TIER_SPECS,
  TEST_ENV_FILE,
  tierUsesFileIsolation,
  buildTestRunnerEnv,
  bunTestArgsForTier,
  bunTestArgsForChanged,
  installBuildConstantGlobals,
  mergeBunTestInvocationArgs,
  parseForwardedBunTestArgs,
  warnIfNodeEnvNotTest,
  resetTestRuntimeWarningsForTests,
} from "../src/lib/test-runtime.ts";
import { REPO_ROOT, testTempDir, withClearedEnv, withEnv } from "./helpers.ts";
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

  describe("Bun signal handling", () => {
    // https://bun.com/docs/test/runtime-behavior#signal-handling
    test("documents graceful and immediate stop signals", () => {
      expect(BUN_TEST_SIGNALS.gracefulStop).toBe("SIGTERM");
      expect(BUN_TEST_SIGNALS.immediateStop).toBe("SIGKILL");
    });

    test("native bun test: SIGTERM stops a running test", async () => {
      const dir = testTempDir("bun-signal-term-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "signal-term.probe.test.ts");
      writeText(
        testPath,
        `import { test } from "bun:test";
test("slow", async () => {
  await new Promise((resolve) => setTimeout(resolve, 120_000));
}, 120_000);`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const proc = Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      });
      await Bun.sleep(400);
      proc.kill("SIGTERM");
      const code = await proc.exited;
      expect(isBunTestFailureExit(code)).toBe(true);
    }, 15_000);
  });

  describe("Bun environment detection", () => {
    // https://bun.com/docs/test/runtime-behavior#environment-detection
    test("documents CI and GitHub Actions detection env keys", () => {
      expect(BUN_TEST_DETECTION_ENV_KEYS).toEqual(["CI", "GITHUB_ACTIONS"]);
    });

    test("isBunCiDetectionEnv recognizes CI markers", () => {
      expect(isBunCiDetectionEnv({ CI: "true" })).toBe(true);
      expect(isBunCiDetectionEnv({ CI: "1" })).toBe(true);
      expect(isBunCiDetectionEnv({ GITHUB_ACTIONS: "true" })).toBe(true);
      expect(isBunCiDetectionEnv({})).toBe(false);
      expect(shouldEmitCiTestReporter({ GITHUB_ACTIONS: "true" })).toBe(true);
    });

    test("buildTestRunnerEnv preserves CI detection env for child spawns", () => {
      withEnv({ CI: "true", GITHUB_ACTIONS: "true" }, () => {
        const env = buildTestRunnerEnv({});
        expect(env.CI).toBe("true");
        expect(env.GITHUB_ACTIONS).toBe("true");
        expect(env.NODE_ENV).toBe("test");
        expect(preservesBunDetectionEnv(env)).toBe(true);
      });
    });
  });

  describe("Bun memory management", () => {
    // https://bun.com/docs/test/runtime-behavior#memory-management
    test("documents --smol and tier-based suite splitting", () => {
      expect(BUN_TEST_MEMORY.lowMemoryFlag).toBe("--smol");
      expect(BUN_TEST_MEMORY.packageScript).toBe("test:smol");
      expect(BUN_TEST_MEMORY.splitStrategy).toBe("tier");
      expect(BUN_TEST_PERFORMANCE.lowMemoryFlag).toBe("--smol");
    });

    test("mergeBunTestInvocationArgs forwards --smol to bun test", () => {
      const dir = testTempDir("test-smol-args-");
      makeDir(dir, { recursive: true });
      const merged = mergeBunTestInvocationArgs(
        ["test", "--isolate"],
        dir,
        ["--smol"]
      );
      expect(bunTestArgsIncludeFlag(merged, "--smol")).toBe(true);
    });

    test("tier order splits suites instead of monolithic bun test", () => {
      expect(TEST_TIER_ORDER).toEqual(["unit", "integration", "smoke"]);
      expect(TEST_TIER_SPECS.unit.files.length).toBeGreaterThan(0);
      expect(TEST_TIER_SPECS.smoke.files.length).toBeGreaterThan(0);
    });
  });

  describe("Bun test isolation", () => {
    // https://bun.com/docs/test/runtime-behavior#test-isolation
    test("documents file isolation and afterEach lifecycle", () => {
      expect(BUN_TEST_ISOLATION.fileIsolationFlag).toBe("--isolate");
      expect(BUN_TEST_ISOLATION.lifecycleHook).toBe("afterEach");
      expect(BUN_TEST_ISOLATION.moduleResetCall).toBe("jest.resetModules()");
      expect(BUN_TEST_ISOLATION.homeEnvKey).toBe("KIMI_TEST_HOME");
      expect(BUN_TEST_ISOLATION_AFTER_EACH_IMPORT).toContain("afterEach");
      expect(BUN_TEST_PERFORMANCE.isolationFlag).toBe("--isolate");
    });

    test("all kimi tiers enable per-file --isolate", () => {
      for (const tier of TEST_TIER_ORDER) {
        const spec = TEST_TIER_SPECS[tier];
        expect(tierUsesFileIsolation(spec)).toBe(true);
        expect(bunTestArgsForTier(spec)).toContain("--isolate");
      }
    });

    test("preload sets KIMI_TEST_HOME for HOME isolation", () => {
      expect(Bun.env.KIMI_TEST_HOME).toBeTruthy();
    });

    test("native bun test: afterEach cleans shared global state", async () => {
      const dir = testTempDir("bun-isolation-aftereach-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "isolation.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect, afterEach } from "bun:test";
const probe = globalThis as { kimiIsolationProbe?: string };
test("sets global", () => {
  probe.kimiIsolationProbe = "dirty";
  expect(probe.kimiIsolationProbe).toBe("dirty");
});
afterEach(() => {
  delete probe.kimiIsolationProbe;
});
test("global cleaned", () => {
  expect(probe.kimiIsolationProbe).toBeUndefined();
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
  });

  describe("Bun watch and hot reloading", () => {
    // https://bun.com/docs/test/runtime-behavior#watch-and-hot-reloading
    test("documents watch vs hot and prefers --watch", () => {
      expect(BUN_TEST_WATCH.watchFlag).toBe("--watch");
      expect(BUN_TEST_WATCH.hotFlag).toBe("--hot");
      expect(BUN_TEST_WATCH.preferredMode).toBe("watch");
      expect(BUN_TEST_WATCH.packageScripts.all).toBe("test:watch");
      expect(BUN_TEST_WATCH.packageScripts.changed).toBe("test:changed:watch");
    });

    test("bunTestWatchArgs builds --watch with isolate by default", () => {
      const args = bunTestWatchArgs();
      expect(isBunTestWatchMode(args)).toBe(true);
      expect(isBunTestHotMode(args)).toBe(false);
      expect(args).toContain("--isolate");
    });

    test("bunTestWatchArgs supports --changed watch loops", () => {
      const args = bunTestWatchArgs({ changedRef: "HEAD" });
      expect(args).toContain("--watch");
      expect(args.some((arg) => arg.startsWith("--changed="))).toBe(true);
    });

    test("bunTestWatchArgs can opt into --hot", () => {
      const args = bunTestWatchArgs({ useHot: true });
      expect(isBunTestHotMode(args)).toBe(true);
      expect(isBunTestWatchMode(args)).toBe(false);
    });

    test("package.json watch scripts use --watch and --isolate, not --hot", async () => {
      const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts["test:watch"]).toContain("--watch");
      expect(pkg.scripts["test:watch"]).toContain("--isolate");
      expect(pkg.scripts["test:watch"]).not.toContain("--hot");
      expect(pkg.scripts["test:changed:watch"]).toContain("--watch");
      expect(pkg.scripts["test:changed:watch"]).toContain("--changed");
      expect(pkg.scripts["test:changed:watch"]).not.toContain("--hot");
    });

    test("bun CLI advertises --watch and --hot for the test runner", async () => {
      const proc = Bun.spawn(["bun", "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(0);
      expect(out).toContain("--watch");
      expect(out).toContain("--hot");
      expect(out).toContain("test runner");
    }, 15_000);
  });

  describe("Bun performance considerations", () => {
    // https://bun.com/docs/test/runtime-behavior#performance-considerations
    test("documents single-process default", () => {
      expect(BUN_TEST_PERFORMANCE.singleProcessDefault).toBe(true);
    });
  });

  describe("Bun installation-related flags", () => {
    // https://bun.com/docs/test/runtime-behavior#installation-related-flags
    test("documents install flags forwarded to bun test", () => {
      expect(BUN_TEST_INSTALL_FLAGS).toEqual(["--prefer-offline", "--frozen-lockfile"]);
      expect(BUN_TEST_INSTALL.preferOfflineFlag).toBe("--prefer-offline");
      expect(BUN_TEST_INSTALL.frozenLockfileFlag).toBe("--frozen-lockfile");
      expect(isBunTestInstallFlag("--prefer-offline")).toBe(true);
      expect(isBunTestInstallFlag("--smol")).toBe(false);
    });

    test("parseForwardedInstallFlags extracts install flags from argv", () => {
      expect(
        parseForwardedInstallFlags(["--push", "--", "--prefer-offline", "--smol"])
      ).toEqual(["--prefer-offline"]);
      expect(parseForwardedInstallFlags(["--frozen-lockfile"])).toEqual(["--frozen-lockfile"]);
    });

    test("mergeBunTestInvocationArgs forwards install flags to bun test", () => {
      const dir = testTempDir("test-install-flags-");
      makeDir(dir, { recursive: true });
      const merged = mergeBunTestInvocationArgs(
        ["test", "--isolate"],
        dir,
        ["--prefer-offline", "--frozen-lockfile"]
      );
      expect(bunTestArgsIncludeFlag(merged, "--prefer-offline")).toBe(true);
      expect(bunTestArgsIncludeFlag(merged, "--frozen-lockfile")).toBe(true);
    });

    test("bunfig.toml enables frozenLockfile for install during tests", async () => {
      const text = await Bun.file(join(REPO_ROOT, "bunfig.toml")).text();
      expect(text).toMatch(/^\s*frozenLockfile\s*=\s*true/m);
    });

    test("bun CLI advertises --prefer-offline", async () => {
      const proc = Bun.spawn(["bun", "--help"], { stdout: "pipe", stderr: "pipe" });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(0);
      expect(out).toContain("--prefer-offline");
    }, 15_000);
  });

  describe("Bun debugging", () => {
    // https://bun.com/docs/test/runtime-behavior#debugging
    test("documents inspect flags and test:debug script", () => {
      expect(BUN_TEST_DEBUG_FLAGS).toEqual(["--inspect", "--inspect-brk"]);
      expect(BUN_TEST_DEBUG.packageScript).toBe("test:debug");
      expect(isBunTestDebugFlag("--inspect-brk")).toBe(true);
      expect(isBunTestDebugFlag("--smol")).toBe(false);
    });

    test("bunTestDebugArgs attaches debugger with isolate by default", () => {
      expect(bunTestDebugArgs()).toEqual(["test", "--inspect", "--isolate"]);
      expect(bunTestDebugArgs({ breakOnStart: true })).toEqual([
        "test",
        "--inspect-brk",
        "--isolate",
      ]);
    });

    test("parseForwardedDebugFlags extracts inspect flags", () => {
      expect(parseForwardedDebugFlags(["--", "--inspect-brk", "--smol"])).toEqual([
        "--inspect-brk",
      ]);
    });

    test("package.json test:debug uses --inspect and --isolate", async () => {
      const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts["test:debug"]).toContain("--inspect");
      expect(pkg.scripts["test:debug"]).toContain("--isolate");
      expect(pkg.scripts["test:debug"]).not.toContain("--inspect-brk");
    });

    test("bun CLI advertises --inspect and --inspect-brk", async () => {
      const proc = Bun.spawn(["bun", "--help"], { stdout: "pipe", stderr: "pipe" });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(0);
      expect(out).toContain("--inspect");
      expect(out).toContain("--inspect-brk");
    }, 15_000);
  });

  describe("Bun module loading", () => {
    // https://bun.com/docs/test/runtime-behavior#module-loading
    test("documents module-loading flags and kimi SSOT paths", () => {
      expect(BUN_TEST_MODULE_LOADING_VALUE_FLAGS).toContain("--preload");
      expect(BUN_TEST_MODULE_LOADING_VALUE_FLAGS).toContain("--define");
      expect(BUN_TEST_MODULE_LOADING_VALUE_FLAGS).toContain("--env-file");
      expect(BUN_TEST_MODULE_LOADING.bunfigPreloadRelPath).toBe("./test/setup.ts");
      expect(BUN_TEST_MODULE_LOADING.defaultEnvFile).toBe(TEST_ENV_FILE);
      expect(BUN_TEST_MODULE_LOADING.defineRegistry).toBe("bunfig.toml [define]");
    });

    test("readBunfigTestPreloadPaths reads declarative preload from bunfig", () => {
      const paths = readBunfigTestPreloadPaths(REPO_ROOT);
      expect(paths).toContain("./test/setup.ts");
    });

    test("parseForwardedBunTestArgs forwards --preload and --define values", () => {
      expect(
        parseForwardedBunTestArgs([
          "--preload",
          "./extra-setup.ts",
          "--define",
          "KIMI_PROBE=1",
        ])
      ).toEqual(["--preload", "./extra-setup.ts", "--define", "KIMI_PROBE=1"]);
      expect(parseForwardedBunTestArgs(["--conditions=development"])).toEqual([
        "--conditions=development",
      ]);
    });

    test("bunfig.toml declares [test].preload and [define] registry", async () => {
      const text = await Bun.file(join(REPO_ROOT, "bunfig.toml")).text();
      expect(text).toContain('[test]');
      expect(text).toContain('preload = ["./test/setup.ts"]');
      expect(text).toContain("[define]");
    });
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