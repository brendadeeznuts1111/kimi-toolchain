import { describe, expect, test } from "bun:test";
import {
  BUN_TEST_DETECTION_ENV_KEYS,
  BUN_TEST_EXIT,
  BUN_TEST_EXPLICIT_IMPORT,
  BUN_TEST_WRITING,
  BUN_TEST_WRITING_EXAMPLES,
  BUN_TEST_WRITING_STRATEGY,
  BUN_TEST_WRITING_BASIC_IMPORT,
  BUN_TEST_WRITING_GROUPED_IMPORT,
  buildBunTestWritingImportLine,
  BUN_TEST_RUN,
  BUN_TEST_RUN_EXAMPLES,
  BUN_TEST_RUN_STRATEGY,
  KIMI_TEST_RUN_ENTRIES,
  BUN_TEST_CHANGED_STRATEGY,
  BUN_TEST_CHANGED_IMPORT_GRAPH,
  BUN_TEST_EXECUTION_STRATEGY,
  isTestRunFailure,
  BUN_TEST_MODULE,
  BUN_TEST_MODULE_STRATEGY,
  KIMI_BUN_TEST_EXTENDED_IMPORT,
  KIMI_BUN_TEST_EXTENDED_SYMBOLS,
  buildBunTestModuleImportLine,
  kimiCoreSymbolInBunTestModule,
  BUN_TEST_GLOBAL_NAMES,
  BUN_TEST_IMPORT_NAMES,
  BUN_TEST_ISOLATION,
  BUN_TEST_ISOLATION_AFTER_EACH_IMPORT,
  BUN_TEST_MEMORY,
  BUN_TEST_PERFORMANCE,
  BUN_TEST_DEFAULT_TIMEOUT_MS,
  BUN_TEST_SIGNALS,
  BUN_TEST_TIMEOUTS,
  BUN_TEST_TIMEOUT_EXAMPLES,
  BUN_TEST_TIMEOUT_STRATEGY,
  BUN_TEST_DISCOVERY,
  BUN_TEST_DISCOVERY_EXAMPLES,
  BUN_TEST_DISCOVERY_STRATEGY,
  basenameMatchesBunTestDiscovery,
  isBunTestExactPathArg,
  readBunfigLogLevel,
  readKimiBunfigRuntimeContract,
  KIMI_BUNFIG_RUNTIME_CONTRACT,
  KIMI_BUNFIG_LOG_LEVEL,
  readBunfigTestRoot,
  readBunfigTestTimeoutMs,
  readKimiBunfigTestContract,
  parseKimiBunfigTestContract,
  BUN_TEST_CONFIGURATION,
  BUN_TEST_CONFIGURATION_EXAMPLES,
  BUN_TEST_CONFIGURATION_STRATEGY,
  KIMI_BUNFIG_TEST_CONTRACT,
  parseForwardedDiscoveryArgs,
  BUN_TEST_TZ,
  applyDefaultTestTimezone,
  defaultTestTimezone,
  isUtcTimezoneOffset,
  readTimeoutMsFromBunTestArgs,
  isDisabledTestTimeout,
  BUN_TEST_DEBUG,
  BUN_TEST_DEBUG_FLAGS,
  BUN_TEST_INSTALL,
  BUN_TEST_INSTALL_FLAGS,
  BUN_TEST_MODULE_LOADING_EXAMPLES,
  BUN_TEST_MODULE_LOADING_STRATEGY,
  BUN_TEST_MODULE_LOADING_VALUE_FLAGS,
  parseForwardedModuleLoadingArgs,
  resolveKimiTestPreloadPath,
  BUN_TEST_CUSTOM_ERROR_HANDLERS,
  BUN_TEST_ERROR_HANDLING,
  BUN_TEST_PROMISE_REJECTIONS,
  BUN_TEST_UNHANDLED_ERRORS,
  BUN_TEST_WATCH,
  isPromiseRejectionRunnerExit,
  isRunnerErrorHandlingExit,
  isRunnerPromiseRejectionOutput,
  isRunnerUnhandledErrorOutput,
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
  BUN_TEST_FLAG_INTERACTIONS,
  BUN_TEST_PARALLEL,
  BUN_TEST_WORKER_ENV_KEYS,
  tierUsesFileIsolation,
  buildTestRunnerEnv,
  bunTestArgBatchesForTier,
  bunTestArgsForTier,
  bunTestArgsForChanged,
  buildBunTestArgs,
  buildBunTestArgBatches,
  bunInvocationWithTestConfig,
  installBuildConstantGlobals,
  mergeBunTestInvocationArgs,
  parseForwardedBunTestArgs,
  warnIfNodeEnvNotTest,
  resetTestRuntimeWarningsForTests,
} from "../src/lib/test-runtime.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { REPO_ROOT, captureStderrWrite, testTempDir, withClearedEnv, withEnv } from "./helpers.ts";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  INTEGRATION_TEST_FILES,
  FAST_TEST_CHUNK_SIZE,
  SMOKE_TEST_FILES,
  UNIT_TEST_FILES,
} from "../src/lib/test-gates.ts";
import { basename, join } from "path";
import { existsSync } from "fs";

describe("test-runtime", () => {
  describe("Bun NODE_ENV contract", () => {
    // https://bun.com/docs/test/runtime-behavior#node_env
    test("with kimi preload: NODE_ENV is test", () => {
      expect(Bun.env.NODE_ENV).toBe("test");
    });

    test("native bun test: explicit NODE_ENV=development is preserved without preload", async () => {
      const dir = testTempDir("bun-node-env-native-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "node-env.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("probe", () => {
  if (Bun.env.NODE_ENV !== "development") process.exit(2);
  expect(Bun.env.NODE_ENV).toBe("development");
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\npreload = []\n");

      const proc = Bun.spawn(["bun", "--config=./bunfig.toml", "test", "node-env.probe.test.ts"], {
        cwd: dir,
        env: {
          HOME: Bun.env.HOME ?? "",
          NODE_ENV: "development",
          PATH: Bun.env.PATH ?? "",
          TMPDIR: Bun.env.TMPDIR ?? "/tmp",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        proc.stdout ? readableStreamToText(proc.stdout) : Promise.resolve(""),
        proc.stderr ? readableStreamToText(proc.stderr) : Promise.resolve(""),
        proc.exited,
      ]);
      if (code !== 0)
        throw new Error(`native bun test failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
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
        const capture = captureStderrWrite();
        try {
          warnIfNodeEnvNotTest("test");
          warnIfNodeEnvNotTest("test");
        } finally {
          capture.restore();
        }
        expect(capture.lines).toHaveLength(1);
        expect(capture.lines[0]).toContain('NODE_ENV was "development"');
        expect(capture.lines[0]).toContain("[test]");
      });
    });
  });

  test("buildTestRunnerEnv forces NODE_ENV=test", () => {
    const env = buildTestRunnerEnv({ NODE_ENV: "development" });
    expect(env.NODE_ENV).toBe("test");
  });

  describe("Bun TZ contract", () => {
    // https://bun.com/docs/test/runtime-behavior#tz-timezone
    test("documents UTC default and TZ env key", () => {
      expect(BUN_TEST_TZ.defaultZone).toBe("Etc/UTC");
      expect(BUN_TEST_TZ.envKey).toBe("TZ");
      expect(defaultTestTimezone({})).toBe("Etc/UTC");
      expect(defaultTestTimezone({ TZ: "America/New_York" })).toBe("America/New_York");
      expect(isUtcTimezoneOffset(0)).toBe(true);
      expect(isUtcTimezoneOffset(240)).toBe(false);
    });

    test("with kimi preload: timezone is UTC", () => {
      expect(Bun.env.TZ).toBe("Etc/UTC");
      expect(new Date().getTimezoneOffset()).toBe(0);
    });

    test("buildTestRunnerEnv defaults TZ to UTC when unset", () => {
      withClearedEnv(["TZ"], () => {
        const env = buildTestRunnerEnv({});
        expect(env.TZ).toBe("Etc/UTC");
      });
    });

    test("buildTestRunnerEnv preserves explicit TZ override", () => {
      withEnv({ TZ: "America/New_York" }, () => {
        const env = buildTestRunnerEnv({});
        expect(env.TZ).toBe("America/New_York");
      });
    });

    test("applyDefaultTestTimezone only fills missing TZ", () => {
      const env: Record<string, string> = {};
      applyDefaultTestTimezone(env);
      expect(env.TZ).toBe("Etc/UTC");
      env.TZ = "Europe/Berlin";
      applyDefaultTestTimezone(env);
      expect(env.TZ).toBe("Europe/Berlin");
    });

    test("native bun test: UTC when TZ is unset", async () => {
      const dir = testTempDir("bun-tz-utc-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "tz-utc.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("timezone is UTC by default", () => {
  expect(new Date().getTimezoneOffset()).toBe(0);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const spawnEnv = { ...Bun.env, NODE_ENV: "test" };
      delete spawnEnv.TZ;
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: spawnEnv,
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: TZ env overrides default UTC", async () => {
      const dir = testTempDir("bun-tz-override-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "tz-override.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("timezone follows TZ env", () => {
  expect(Bun.env.TZ).toBe("America/New_York");
  expect(new Date().getTimezoneOffset()).not.toBe(0);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test", TZ: "America/New_York" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);
  });

  test("tier order runs unit before integration and smoke", () => {
    expect(TEST_TIER_ORDER).toEqual(["unit", "integration", "smoke"]);
  });

  test("unit tier uses parallel isolate args", () => {
    const args = bunTestArgsForTier(TEST_TIER_SPECS.unit);
    expect(args).toContain("--isolate");
    expect(args).toContain("--parallel=2");
    expect(args).not.toContain("--parallel");
    expect(args[0]).toBe("test");
  });

  test("unit tier batches avoid one giant parallel worker run", () => {
    const batches = bunTestArgBatchesForTier(TEST_TIER_SPECS.unit);
    const files = batches.flatMap((batch) =>
      batch.filter((arg) => (UNIT_TEST_FILES as readonly string[]).includes(arg))
    );

    expect(files).toEqual([...UNIT_TEST_FILES]);
    for (const batch of batches) {
      expect(batch).toContain("--isolate");
      expect(batch).not.toContain("--parallel=4");
      // When parallelism is low (e.g. 2 workers) the runner intentionally
      // disables chunking to avoid a Bun canary panic during bun build --compile.
      if (batches.length > 1) {
        expect(
          batch.filter((arg) => (UNIT_TEST_FILES as readonly string[]).includes(arg)).length
        ).toBeLessThanOrEqual(FAST_TEST_CHUNK_SIZE);
      }
    }
  });

  describe("Bun test module", () => {
    // https://bun.com/reference/bun/test
    test("documents bun:test module exports and kimi import strategy", () => {
      expect(BUN_TEST_MODULE.name).toBe("bun:test");
      expect(BUN_TEST_MODULE.jestCompatible).toBe(true);
      expect(BUN_TEST_MODULE.constExports).toContain("test");
      expect(BUN_TEST_MODULE.constExports).toContain("mock");
      expect(BUN_TEST_MODULE.functionExports).toContain("beforeEach");
      expect(BUN_TEST_MODULE.functionExports).toContain("spyOn");
      expect(BUN_TEST_MODULE.namespaces).toEqual(["jest"]);
      expect(BUN_TEST_MODULE.skipAliases.xtest).toBe("test.skip");
      expect(BUN_TEST_MODULE_STRATEGY.imports).toBe(
        "explicit-import-preferred-over-injected-globals"
      );
      expect(BUN_TEST_WRITING.module).toBe(BUN_TEST_MODULE.name);
      expect(BUN_TEST_EXPLICIT_IMPORT).toBe(buildBunTestModuleImportLine(BUN_TEST_IMPORT_NAMES));
      expect(KIMI_BUN_TEST_EXTENDED_SYMBOLS).toContain("mock");
      expect(KIMI_BUN_TEST_EXTENDED_IMPORT).toContain("mock");
      for (const symbol of BUN_TEST_IMPORT_NAMES) {
        expect(kimiCoreSymbolInBunTestModule(symbol)).toBe(true);
      }
    });

    test("native bun test: explicit bun:test imports for mock and lifecycle hooks", async () => {
      const dir = testTempDir("bun-module-api-");
      const testPath = join(dir, "module-api.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
let counter = 0;
beforeEach(() => {
  counter = 0;
});
afterEach(() => {
  counter = 0;
});
describe("bun:test api", () => {
  test("mock()", () => {
    const fn = mock(() => 1);
    expect(fn()).toBe(1);
    expect(fn).toHaveBeenCalled();
    counter += 1;
    expect(counter).toBe(1);
  });
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);
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
        env: { ...Bun.env, NODE_ENV: "test" },
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

  describe("Bun writing tests", () => {
    // https://bun.com/docs/test/writing-tests#basic-usage
    test("documents basic usage, grouping, and async examples from Bun docs", () => {
      expect(BUN_TEST_WRITING.module).toBe("bun:test");
      expect(BUN_TEST_WRITING.basicSymbols).toEqual(["expect", "test"]);
      expect(BUN_TEST_WRITING.groupingSymbol).toBe("describe");
      expect(BUN_TEST_WRITING_EXAMPLES.basic.name).toBe("2 + 2");
      expect(BUN_TEST_WRITING_EXAMPLES.grouped.suite).toBe("arithmetic");
      expect(BUN_TEST_WRITING_EXAMPLES.grouped.cases).toHaveLength(2);
      expect(BUN_TEST_WRITING_STRATEGY.imports).toBe("explicit-from-bun:test-see-test-testing.md");
      expect(BUN_TEST_WRITING_BASIC_IMPORT).toBe(buildBunTestWritingImportLine(["expect", "test"]));
      expect(BUN_TEST_WRITING_GROUPED_IMPORT).toBe(
        buildBunTestWritingImportLine(["expect", "test", "describe"])
      );
      expect(BUN_TEST_EXPLICIT_IMPORT).toContain('from "bun:test"');
      for (const name of BUN_TEST_IMPORT_NAMES) {
        expect(BUN_TEST_EXPLICIT_IMPORT).toContain(name);
      }
      expect(BUN_TEST_IMPORT_NAMES).toEqual(BUN_TEST_GLOBAL_NAMES);
    });

    test("native bun test: basic sync test from writing-tests doc", async () => {
      const dir = testTempDir("bun-writing-basic-");
      const testPath = join(dir, "math.test.ts");
      const ex = BUN_TEST_WRITING_EXAMPLES.basic;
      writeText(
        testPath,
        `${BUN_TEST_WRITING_BASIC_IMPORT}
test(${JSON.stringify(ex.name)}, () => {
  expect(2 + 2).${ex.matcher}(${ex.expected});
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: describe grouping from writing-tests doc", async () => {
      const dir = testTempDir("bun-writing-grouped-");
      const testPath = join(dir, "math.test.ts");
      const ex = BUN_TEST_WRITING_EXAMPLES.grouped;
      const cases = ex.cases
        .map(
          (entry) => `  test(${JSON.stringify(entry.name)}, () => {
    expect(${entry.name.includes("+") ? "2 + 2" : "2 * 2"}).toBe(${entry.expected});
  });`
        )
        .join("\n\n");
      writeText(
        testPath,
        `${BUN_TEST_WRITING_GROUPED_IMPORT}
describe(${JSON.stringify(ex.suite)}, () => {
${cases}
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: async await style from writing-tests doc", async () => {
      const dir = testTempDir("bun-writing-async-");
      const testPath = join(dir, "math.test.ts");
      const ex = BUN_TEST_WRITING_EXAMPLES.asyncAwait;
      writeText(
        testPath,
        `${BUN_TEST_WRITING_BASIC_IMPORT}
test(${JSON.stringify(ex.name)}, async () => {
  const result = await Promise.resolve(2 * 2);
  expect(result).toEqual(${ex.expected});
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: done callback style from writing-tests doc", async () => {
      const dir = testTempDir("bun-writing-done-");
      const testPath = join(dir, "math.test.ts");
      const ex = BUN_TEST_WRITING_EXAMPLES.asyncDone;
      writeText(
        testPath,
        `${BUN_TEST_WRITING_BASIC_IMPORT}
test(${JSON.stringify(ex.name)}, (done) => {
  Promise.resolve(2 * 2).then((result) => {
    expect(result).toEqual(${ex.expected});
    done();
  });
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);
  });

  describe("Bun run tests", () => {
    // https://bun.com/docs/test#run-tests
    test("documents bun test command, examples, and kimi entry points", () => {
      expect(BUN_TEST_RUN.command).toBe("bun test");
      expect(BUN_TEST_RUN.singleProcess).toBe(true);
      expect(BUN_TEST_RUN.exitsNonZeroOnFailure).toBe(true);
      expect(BUN_TEST_RUN.defaultTimeoutMs).toBe(BUN_TEST_DEFAULT_TIMEOUT_MS);
      expect(BUN_TEST_RUN_EXAMPLES.all).toEqual(["test"]);
      expect(BUN_TEST_RUN_EXAMPLES.pathFilters).toEqual(["test", "foo", "bar"]);
      expect(BUN_TEST_RUN_EXAMPLES.exactPath[1]).toBe("./test/specific-file.test.ts");
      expect(BUN_TEST_RUN_STRATEGY.kimiFull).toBe("package-test-scripts-test-run-runAllTestTiers");
      expect(BUN_TEST_RUN_STRATEGY.kimiFast).toBe(
        "package-test-fast-scripts-test-fast-runTestTier-unit"
      );
      expect(KIMI_TEST_RUN_ENTRIES.fast.tier).toBe("unit");
      expect(KIMI_TEST_RUN_ENTRIES.all.runner).toBe("runAllTestTiers");
      expect(KIMI_TEST_RUN_ENTRIES.changed.selection).toBe("git-import-graph");
      expect(KIMI_TEST_RUN_ENTRIES.parallel.selection).toBe("full-discovery");
      expect(KIMI_TEST_RUN_ENTRIES.shard.runner).toBe("bare-bun-test");
      expect(BUN_TEST_CHANGED_STRATEGY.limitations).toBe(
        "static-import-graph-only-may-miss-indirect-effects"
      );
      expect(BUN_TEST_CHANGED_STRATEGY.safetyNet).toBe("test-parallel-test-shard-full-discovery");
      expect(BUN_TEST_CHANGED_IMPORT_GRAPH.title).toContain("--changed");
      expect(BUN_TEST_CHANGED_IMPORT_GRAPH.pipeline).toHaveLength(4);
      expect(BUN_TEST_CHANGED_IMPORT_GRAPH.safetyNet.scripts).toContain("test:parallel");
      expect(BUN_TEST_EXECUTION_STRATEGY.referenceDoc).toBe("docs/references/testing-execution.md");
      expect(BUN_TEST_EXECUTION_STRATEGY.distributionUnit).toBe("test-file-not-describe-block");
      expect(BUN_TEST_EXECUTION_STRATEGY.primaryScripts).toEqual([
        "test:fast",
        "test:changed",
        "test:parallel",
        "test:shard",
      ]);
      expect(BUN_TEST_EXECUTION_STRATEGY.fileDistributionGoals.workerParallelism).toEqual({
        describe: "same-file-same-worker",
        separateFiles: "workers-run-concurrently",
      });
      expect(isTestRunFailure(1)).toBe(true);
      expect(isTestRunFailure(0)).toBe(false);
    });

    test("package.json test scripts match KIMI_TEST_RUN_ENTRIES", async () => {
      const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
        scripts: Record<string, string>;
      };
      for (const entry of Object.values(KIMI_TEST_RUN_ENTRIES)) {
        expect(pkg.scripts[entry.packageScript]).toBe(entry.command);
      }
    });

    test("native bun test: bare command discovers and passes math.test.ts", async () => {
      const dir = testTempDir("bun-run-all-");
      writeText(
        join(dir, "math.test.ts"),
        `${BUN_TEST_WRITING_BASIC_IMPORT}
test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", ...BUN_TEST_RUN_EXAMPLES.all], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: exits non-zero when a test fails", async () => {
      const dir = testTempDir("bun-run-fail-");
      const testPath = join(dir, "fail.probe.test.ts");
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
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(isTestRunFailure(code)).toBe(true);
      expect(code).toBe(BUN_TEST_EXIT.failures);
    }, 15_000);

    test("native bun test: --test-name-pattern filters by test name", async () => {
      const dir = testTempDir("bun-run-name-pattern-");
      const additionMarker = join(dir, "ran-addition");
      const subtractionMarker = join(dir, "ran-subtraction");
      writeText(
        join(dir, "math.test.ts"),
        `import { test, expect } from "bun:test";
test("addition works", () => {
  Bun.write(${JSON.stringify(additionMarker)}, "1");
  expect(1 + 1).toBe(2);
});
test("subtraction works", () => {
  Bun.write(${JSON.stringify(subtractionMarker)}, "1");
  expect(2 - 1).toBe(1);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(
        ["bun", "test", "--test-name-pattern", "addition", "./math.test.ts"],
        {
          cwd: dir,
          env: { ...Bun.env, NODE_ENV: "test" },
          stdout: "pipe",
          stderr: "pipe",
        }
      ).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
      expect(existsSync(additionMarker)).toBe(true);
      expect(existsSync(subtractionMarker)).toBe(false);
    }, 15_000);
  });

  describe("Bun process integration", () => {
    // https://bun.com/docs/test/runtime-behavior#process-integration
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
        env: { ...Bun.env, NODE_ENV: "test" },
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
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.failures);
    }, 15_000);
  });

  describe("Bun test timeouts", () => {
    // https://bun.com/docs/test/runtime-behavior#test-timeouts
    test("documents global, per-test, and infinite timeout examples from Bun docs", () => {
      expect(BUN_TEST_DEFAULT_TIMEOUT_MS).toBe(5000);
      expect(BUN_TEST_TIMEOUTS.bunDefaultMs).toBe(5000);
      expect(BUN_TEST_TIMEOUTS.globalFlag).toBe("--timeout");
      expect(BUN_TEST_TIMEOUTS.perTestParameterIndex).toBe(2);
      expect(BUN_TEST_TIMEOUTS.kimi.fast).toBe(30_000);
      expect(BUN_TEST_TIMEOUTS.kimi.default).toBe(30_000);
      expect(BUN_TEST_TIMEOUTS.kimi.smoke).toBe(60_000);
      expect(TEST_TIER_SPECS.unit.timeoutMs).toBe(BUN_TEST_TIMEOUTS.kimi.fast);
      expect(TEST_TIER_SPECS.smoke.timeoutMs).toBe(BUN_TEST_TIMEOUTS.kimi.smoke);
      expect(BUN_TEST_TIMEOUT_EXAMPLES.global).toEqual(["test", "--timeout", "10000"]);
      expect(BUN_TEST_TIMEOUT_EXAMPLES.perTestFast).toEqual({
        name: "fast test",
        timeoutMs: 1000,
      });
      expect(BUN_TEST_TIMEOUT_EXAMPLES.perTestSlow.timeoutMs).toBe(10_000);
      expect(BUN_TEST_TIMEOUT_EXAMPLES.infiniteZero).toBe(0);
      expect(BUN_TEST_TIMEOUT_EXAMPLES.infiniteInfinity).toBe(Infinity);
      expect(BUN_TEST_TIMEOUT_STRATEGY.global).toBe("tier-runners-via-bunTestArgsForTier");
      expect(BUN_TEST_TIMEOUT_STRATEGY.perTest).toBe("author-third-argument-overrides-global");
      expect(BUN_TEST_TIMEOUT_STRATEGY.infinite).toBe("per-test-0-or-Infinity-disables-limit");
      for (const value of BUN_TEST_TIMEOUTS.disableValues) {
        expect(isDisabledTestTimeout(value)).toBe(true);
      }
      expect(isDisabledTestTimeout(30_000)).toBe(false);
    });

    test("readTimeoutMsFromBunTestArgs parses doc global --timeout 10000", () => {
      expect(readTimeoutMsFromBunTestArgs(BUN_TEST_TIMEOUT_EXAMPLES.global)).toBe(10_000);
    });

    test("bunTestArgsForTier includes global --timeout flag", () => {
      const args = bunTestArgsForTier(TEST_TIER_SPECS.unit);
      expect(readTimeoutMsFromBunTestArgs(args)).toBe(30_000);
    });

    test("native bun test: global --timeout fails slow tests", async () => {
      const dir = testTempDir("bun-timeout-global-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "timeout-global.probe.test.ts");
      writeText(
        testPath,
        `import { test } from "bun:test";
test("slow", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", "--timeout", "200", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.failures);
    }, 15_000);

    test("native bun test: per-test timeout overrides global --timeout", async () => {
      const dir = testTempDir("bun-timeout-per-test-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "timeout-per-test.probe.test.ts");
      const slowMs = BUN_TEST_TIMEOUT_EXAMPLES.perTestSlow.timeoutMs;
      writeText(
        testPath,
        `import { test } from "bun:test";
test("slow test", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
}, ${slowMs});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", "--timeout", "200", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);

    test("native bun test: per-test timeout 0 disables limit under global --timeout", async () => {
      const dir = testTempDir("bun-timeout-infinite-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "timeout-infinite.probe.test.ts");
      writeText(
        testPath,
        `import { test } from "bun:test";
test("test without timeout", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
}, ${BUN_TEST_TIMEOUT_EXAMPLES.infiniteZero});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", "--timeout", "200", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
    }, 15_000);
  });

  describe("Bun test discovery", () => {
    // https://bun.com/docs/test/discovery#default-discovery-logic
    test("documents default patterns, exclusions, and kimi strategy", () => {
      expect(BUN_TEST_DISCOVERY.patternDescriptions).toEqual([
        "*.test.{js|jsx|ts|tsx}",
        "*_test.{js|jsx|ts|tsx}",
        "*.spec.{js|jsx|ts|tsx}",
        "*_spec.{js|jsx|ts|tsx}",
      ]);
      expect(BUN_TEST_DISCOVERY.exclusions).toContain("node_modules");
      expect(BUN_TEST_DISCOVERY.exclusions).toContain("hidden-directories");
      expect(BUN_TEST_DISCOVERY_EXAMPLES.substringFilter).toEqual(["test", "utils"]);
      expect(BUN_TEST_DISCOVERY_EXAMPLES.exactPath[1]).toBe("./test/specific-file.test.ts");
      expect(BUN_TEST_DISCOVERY_STRATEGY.tierFiles).toBe(
        "explicit-paths-from-test-gates-UNIT_TEST_FILES"
      );
      expect(readBunfigTestRoot(REPO_ROOT)).toBeUndefined();
    });

    test("basenameMatchesBunTestDiscovery accepts all Bun default suffixes", () => {
      expect(basenameMatchesBunTestDiscovery("string.test.ts")).toBe(true);
      expect(basenameMatchesBunTestDiscovery("array_test.js")).toBe(true);
      expect(basenameMatchesBunTestDiscovery("math.spec.tsx")).toBe(true);
      expect(basenameMatchesBunTestDiscovery("probe_spec.ts")).toBe(true);
      expect(basenameMatchesBunTestDiscovery("lib.unit.test.ts")).toBe(true);
      expect(basenameMatchesBunTestDiscovery("readme.md")).toBe(false);
    });

    test("kimi tier file lists match Bun default discovery patterns", () => {
      for (const file of [...UNIT_TEST_FILES, ...INTEGRATION_TEST_FILES, ...SMOKE_TEST_FILES]) {
        expect(basenameMatchesBunTestDiscovery(basename(file))).toBe(true);
      }
    });

    test("bunTestArgsForTier passes explicit gate file paths", () => {
      const args = bunTestArgsForTier(TEST_TIER_SPECS.unit);
      const paths = args.filter((arg) => (UNIT_TEST_FILES as readonly string[]).includes(arg));
      expect(paths).toEqual([...UNIT_TEST_FILES]);
    });

    test("isBunTestExactPathArg distinguishes exact paths from substring filters", () => {
      expect(isBunTestExactPathArg("./test/specific-file.test.ts")).toBe(true);
      expect(isBunTestExactPathArg("/tmp/probe.test.ts")).toBe(true);
      expect(isBunTestExactPathArg("utils")).toBe(false);
    });

    test("parseForwardedDiscoveryArgs forwards --test-name-pattern", () => {
      expect(parseForwardedDiscoveryArgs(["--test-name-pattern", "addition", "--smol"])).toEqual([
        "--test-name-pattern",
        "addition",
      ]);
      expect(parseForwardedDiscoveryArgs(["-t", "Math"])).toEqual(["-t", "Math"]);
    });

    test("native bun test: substring filter matches path segments", async () => {
      const dir = testTempDir("bun-discovery-filter-");
      const utilsMarker = join(dir, "ran-utils");
      const plainMarker = join(dir, "ran-plain");
      makeDir(join(dir, "src/utils"), { recursive: true });
      makeDir(join(dir, "lib"), { recursive: true });
      writeText(
        join(dir, "src/utils/string.test.ts"),
        `import { test, expect } from "bun:test";
test("utils probe", () => {
  Bun.write(${JSON.stringify(utilsMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(
        join(dir, "lib/plain.test.ts"),
        `import { test, expect } from "bun:test";
test("plain probe", () => {
  Bun.write(${JSON.stringify(plainMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", "utils"], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
      expect(existsSync(utilsMarker)).toBe(true);
      expect(existsSync(plainMarker)).toBe(false);
    }, 15_000);

    test("native bun test: ./ prefix runs an exact file path", async () => {
      const dir = testTempDir("bun-discovery-exact-");
      const specificMarker = join(dir, "ran-specific");
      const otherMarker = join(dir, "ran-other");
      writeText(
        join(dir, "specific.test.ts"),
        `import { test, expect } from "bun:test";
test("specific probe", () => {
  Bun.write(${JSON.stringify(specificMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(
        join(dir, "other.test.ts"),
        `import { test, expect } from "bun:test";
test("other probe", () => {
  Bun.write(${JSON.stringify(otherMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test", "./specific.test.ts"], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
      expect(existsSync(specificMarker)).toBe(true);
      expect(existsSync(otherMarker)).toBe(false);
    }, 15_000);

    test("native bun test: skips hidden directories during default discovery", async () => {
      const dir = testTempDir("bun-discovery-hidden-");
      const hiddenMarker = join(dir, "ran-hidden");
      const visibleMarker = join(dir, "ran-visible");
      makeDir(join(dir, ".hidden"), { recursive: true });
      makeDir(join(dir, "visible"), { recursive: true });
      writeText(
        join(dir, ".hidden/hidden.test.ts"),
        `import { test, expect } from "bun:test";
test("hidden probe", () => {
  Bun.write(${JSON.stringify(hiddenMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(
        join(dir, "visible/visible.test.ts"),
        `import { test, expect } from "bun:test";
test("visible probe", () => {
  Bun.write(${JSON.stringify(visibleMarker)}, "1");
  expect(1).toBe(1);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const code = await Bun.spawn(["bun", "test"], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
      expect(existsSync(visibleMarker)).toBe(true);
      expect(existsSync(hiddenMarker)).toBe(false);
    }, 15_000);
  });

  describe("Bun test configuration", () => {
    // https://bun.com/docs/test/configuration#configuration-file
    test("documents bunfig [test] section, examples, and kimi strategy", () => {
      expect(BUN_TEST_CONFIGURATION.section).toBe("[test]");
      expect(BUN_TEST_CONFIGURATION.reporterSection).toBe("[test.reporter]");
      expect(BUN_TEST_CONFIGURATION.keys).toContain("preload");
      expect(BUN_TEST_CONFIGURATION.keys).toContain("timeout");
      expect(BUN_TEST_CONFIGURATION.keys).toContain("coverageThreshold");
      expect(BUN_TEST_CONFIGURATION_EXAMPLES.preload).toEqual([
        "./test-setup.ts",
        "./global-mocks.ts",
      ]);
      expect(BUN_TEST_CONFIGURATION_EXAMPLES.timeoutMs).toBe(10_000);
      expect(BUN_TEST_CONFIGURATION_STRATEGY.bunfig).toBe("declarative-SSOT-bunfig.toml-[test]");
      expect(BUN_TEST_CONFIGURATION_STRATEGY.timeout).toBe(
        "tier-runners-pass-cli---timeout-overrides-bunfig"
      );
    });

    test("readBunfigLogLevel matches kimi-toolchain warn default", () => {
      expect(readBunfigLogLevel(REPO_ROOT)).toBe(KIMI_BUNFIG_LOG_LEVEL);
      expect(KIMI_BUNFIG_LOG_LEVEL).toBe("warn");
    });

    test("readKimiBunfigRuntimeContract matches repo bunfig.toml runtime policy", () => {
      expect(readKimiBunfigRuntimeContract(REPO_ROOT)).toEqual(KIMI_BUNFIG_RUNTIME_CONTRACT);
    });

    test("readKimiBunfigTestContract matches repo bunfig.toml [test] contract", () => {
      const contract = readKimiBunfigTestContract(REPO_ROOT);
      expect(contract).toEqual(KIMI_BUNFIG_TEST_CONTRACT);
      expect(readBunfigTestPreloadPaths(REPO_ROOT)).toEqual([...KIMI_BUNFIG_TEST_CONTRACT.preload]);
      expect(readBunfigTestRoot(REPO_ROOT)).toBeUndefined();
      expect(readBunfigTestTimeoutMs(REPO_ROOT)).toBe(15000);
    });

    test("parseKimiBunfigTestContract rejects incomplete [test] tables", () => {
      expect(parseKimiBunfigTestContract(undefined)).toBeUndefined();
      expect(parseKimiBunfigTestContract({ preload: ["./setup.ts"] })).toBeUndefined();
    });

    test("tier runners pass CLI --timeout and omit bunfig preload flag", () => {
      const args = bunTestArgsForTier(TEST_TIER_SPECS.unit, { repoRoot: REPO_ROOT });
      expect(readTimeoutMsFromBunTestArgs(args)).toBe(TEST_TIER_SPECS.unit.timeoutMs);
      expect(args).not.toContain("--preload");
      expect(resolveKimiTestPreloadPath(REPO_ROOT)).toBe(KIMI_BUNFIG_TEST_CONTRACT.preload[0] ?? "");
    });

    test("native bun test: bunfig preload runs before tests", async () => {
      const dir = testTempDir("bun-config-preload-");
      const marker = join(dir, "preload-ran");
      writeText(
        join(dir, "preload.ts"),
        `globalThis.__PRELOAD_RAN__ = true;
Bun.write(${JSON.stringify(marker)}, "1");`
      );
      writeText(
        join(dir, "probe.test.ts"),
        `import { test, expect } from "bun:test";
test("preload probe", () => {
  expect(globalThis.__PRELOAD_RAN__).toBe(true);
});`
      );
      writeText(join(dir, "bunfig.toml"), `[test]\npreload = ["./preload.ts"]\n`);
      const code = await Bun.spawn(["bun", "test", "./probe.test.ts"], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.ok);
      expect(existsSync(marker)).toBe(true);
    }, 15_000);

    test("native bun test: CLI --timeout overrides bunfig timeout default", async () => {
      const dir = testTempDir("bun-config-timeout-override-");
      const testPath = join(dir, "timeout-override.probe.test.ts");
      writeText(
        testPath,
        `import { test } from "bun:test";
test("slow", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\ntimeout = 5000\n");
      const code = await Bun.spawn(["bun", "test", "--timeout", "200", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      expect(code).toBe(BUN_TEST_EXIT.failures);
      expect(readBunfigTestTimeoutMs(dir)).toBe(5000);
    }, 15_000);
  });

  describe("Bun error handling", () => {
    // https://bun.com/docs/test/runtime-behavior#error-handling
    test("documents error-handling umbrella and kimi preload policy", () => {
      expect(BUN_TEST_ERROR_HANDLING.runnerBanner).toBe("Unhandled error between tests");
      expect(BUN_TEST_ERROR_HANDLING.failsDespitePassingTests).toBe(true);
      expect(BUN_TEST_ERROR_HANDLING.kimiUsesBunRunnerTracking).toBe(true);
      expect(BUN_TEST_ERROR_HANDLING.customHandlerEvents).toEqual([
        "uncaughtException",
        "unhandledRejection",
      ]);
      expect(BUN_TEST_CUSTOM_ERROR_HANDLERS).toHaveLength(2);
      expect(BUN_TEST_UNHANDLED_ERRORS.docPattern).toContain("setTimeout");
      expect(BUN_TEST_PROMISE_REJECTIONS.runnerBanner).toBe(BUN_TEST_ERROR_HANDLING.runnerBanner);
    });

    test("test/setup.ts does not install custom process error handlers", async () => {
      const text = await Bun.file(join(REPO_ROOT, "test/setup.ts")).text();
      expect(text).not.toContain('process.on("uncaughtException"');
      expect(text).not.toContain('process.on("unhandledRejection"');
    });

    test("native bun test: inter-test setTimeout throw fails the run", async () => {
      const dir = testTempDir("bun-unhandled-error-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "unhandled-error.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("test 1", () => {
  expect(true).toBe(true);
});
setTimeout(() => {
  throw new Error("Unhandled error");
}, 0);
test("test 2", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(true).toBe(true);
});`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const proc = Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, combined] = await Promise.all([
        proc.exited,
        Promise.all([readableStreamToText(proc.stdout), readableStreamToText(proc.stderr)]).then(
          ([out, err]) => out + err
        ),
      ]);
      expect(isRunnerErrorHandlingExit(code)).toBe(true);
      expect(isRunnerUnhandledErrorOutput(combined)).toBe(true);
    }, 15_000);

    // https://bun.com/docs/test/runtime-behavior#promise-rejections
    test("documents promise rejection runner contract", () => {
      expect(BUN_TEST_PROMISE_REJECTIONS.failsDespitePassingTests).toBe(true);
      expect(BUN_TEST_PROMISE_REJECTIONS.docPattern).toContain("Promise.reject");
      expect(BUN_TEST_PROMISE_REJECTIONS.runnerBanner).toBe("Unhandled error between tests");
    });

    test("isRunnerPromiseRejectionOutput detects Bun runner banner", () => {
      const sample = `# Unhandled error between tests
error: Unhandled rejection`;
      expect(isRunnerPromiseRejectionOutput(sample)).toBe(true);
      expect(isRunnerPromiseRejectionOutput("all passed")).toBe(false);
      expect(isPromiseRejectionRunnerExit(1)).toBe(true);
      expect(isPromiseRejectionRunnerExit(0)).toBe(false);
    });

    test("native bun test: module-level Promise.reject fails despite passing test", async () => {
      const dir = testTempDir("bun-promise-reject-");
      makeDir(dir, { recursive: true });
      const testPath = join(dir, "promise-reject.probe.test.ts");
      writeText(
        testPath,
        `import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});
Promise.reject(new Error("Unhandled rejection"));`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\n");
      const proc = Bun.spawn(["bun", "test", testPath], {
        cwd: dir,
        env: { ...Bun.env, NODE_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, err] = await Promise.all([proc.exited, readableStreamToText(proc.stderr)]);
      expect(isPromiseRejectionRunnerExit(code)).toBe(true);
      expect(isRunnerPromiseRejectionOutput(err)).toBe(true);
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
        env: { ...Bun.env, NODE_ENV: "test" },
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
      const merged = mergeBunTestInvocationArgs(["test", "--isolate"], dir, ["--smol"]);
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
        env: { ...Bun.env, NODE_ENV: "test" },
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
      expect(pkg.scripts["test:changed:watch"]).toBeUndefined();
    });

    test("bun CLI advertises --watch and --hot for the test runner", async () => {
      const proc = Bun.spawn(["bun", "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out] = await Promise.all([proc.exited, readableStreamToText(proc.stdout)]);
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
      expect(parseForwardedInstallFlags(["--push", "--", "--prefer-offline", "--smol"])).toEqual([
        "--prefer-offline",
      ]);
      expect(parseForwardedInstallFlags(["--frozen-lockfile"])).toEqual(["--frozen-lockfile"]);
    });

    test("mergeBunTestInvocationArgs forwards install flags to bun test", () => {
      const dir = testTempDir("test-install-flags-");
      makeDir(dir, { recursive: true });
      const merged = mergeBunTestInvocationArgs(["test", "--isolate"], dir, [
        "--prefer-offline",
        "--frozen-lockfile",
      ]);
      expect(bunTestArgsIncludeFlag(merged, "--prefer-offline")).toBe(true);
      expect(bunTestArgsIncludeFlag(merged, "--frozen-lockfile")).toBe(true);
    });

    test("bunfig.toml enables frozenLockfile for install during tests", async () => {
      const text = await Bun.file(join(REPO_ROOT, "bunfig.toml")).text();
      expect(text).toMatch(/^\s*frozenLockfile\s*=\s*true/m);
    });

    test("bun CLI advertises --prefer-offline", async () => {
      const proc = Bun.spawn(["bun", "--help"], { stdout: "pipe", stderr: "pipe" });
      const [code, out] = await Promise.all([proc.exited, readableStreamToText(proc.stdout)]);
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
      const [code, out] = await Promise.all([proc.exited, readableStreamToText(proc.stdout)]);
      expect(code).toBe(0);
      expect(out).toContain("--inspect");
      expect(out).toContain("--inspect-brk");
    }, 15_000);
  });

  describe("Bun module loading", () => {
    // https://bun.com/docs/test/runtime-behavior#module-loading
    test("documents all six module-loading CLI examples from Bun docs", () => {
      expect(BUN_TEST_MODULE_LOADING_VALUE_FLAGS).toEqual([
        "--preload",
        "--define",
        "--loader",
        "--tsconfig-override",
        "--conditions",
        "--env-file",
      ]);
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.preload).toEqual(["test", "--preload", "./setup.ts"]);
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.define[1]).toBe("--define");
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.loader).toEqual([
        "test",
        "--loader",
        ".special:special-loader",
      ]);
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.tsconfigOverride).toEqual([
        "test",
        "--tsconfig-override",
        "./test-tsconfig.json",
      ]);
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.conditions).toEqual([
        "test",
        "--conditions",
        "development",
      ]);
      expect(BUN_TEST_MODULE_LOADING_EXAMPLES.envFile).toEqual([
        "test",
        "--env-file",
        TEST_ENV_FILE,
      ]);
      expect(BUN_TEST_MODULE_LOADING_STRATEGY.preload).toBe("bunfig-[test].preload");
      expect(BUN_TEST_MODULE_LOADING_STRATEGY.envFile).toBe("auto-merge-.env.test");
    });

    test("resolveKimiTestPreloadPath reads bunfig declarative preload", () => {
      expect(resolveKimiTestPreloadPath(REPO_ROOT)).toBe("./test/setup.ts");
      expect(readBunfigTestPreloadPaths(REPO_ROOT)).toContain("./test/setup.ts");
    });

    test("parseForwardedModuleLoadingArgs forwards all doc flags", () => {
      expect(
        parseForwardedModuleLoadingArgs([
          "--preload",
          "./extra-setup.ts",
          "--define",
          "KIMI_PROBE=1",
          "--loader",
          ".special:special-loader",
          "--tsconfig-override",
          "./test-tsconfig.json",
          "--conditions",
          "development",
        ])
      ).toEqual([
        "--preload",
        "./extra-setup.ts",
        "--define",
        "KIMI_PROBE=1",
        "--loader",
        ".special:special-loader",
        "--tsconfig-override",
        "./test-tsconfig.json",
        "--conditions",
        "development",
      ]);
      expect(parseForwardedModuleLoadingArgs(["--conditions=development"])).toEqual([
        "--conditions=development",
      ]);
    });

    test("mergeBunTestInvocationArgs auto-appends .env.test per doc example", () => {
      const dir = testTempDir("module-loading-env-");
      makeDir(dir, { recursive: true });
      writeText(join(dir, TEST_ENV_FILE), "KIMI_MODULE_LOADING_PROBE=1\n");
      const merged = mergeBunTestInvocationArgs(["test", "--isolate"], dir, []);
      expect(merged).toContain("--env-file");
      expect(merged).toContain(TEST_ENV_FILE);
    });

    test("tier runners omit CLI --preload when bunfig already declares preload", () => {
      const args = bunTestArgsForTier(TEST_TIER_SPECS.unit, { repoRoot: REPO_ROOT });
      expect(args).not.toContain("--preload");
      expect(resolveKimiTestPreloadPath(REPO_ROOT)).toBe("./test/setup.ts");
    });

    test("bunfig.toml declares [test].preload and [define] registry", async () => {
      const text = await Bun.file(join(REPO_ROOT, "bunfig.toml")).text();
      expect(text).toContain("[test]");
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
      expect(args).toContain("--parallel=4");
      expect(args).not.toContain("--parallel");
      expect(args.some((arg) => arg.startsWith("--changed="))).toBe(true);
    });

    test("bunInvocationWithTestConfig uses Bun CLI --config flag", () => {
      const args = bunInvocationWithTestConfig(
        ["test", "--timeout", "30000"],
        "/repo/.kimi/test-runner-bunfig.toml"
      );
      expect(args).toEqual([
        "--config=/repo/.kimi/test-runner-bunfig.toml",
        "test",
        "--timeout",
        "30000",
      ]);
    });

    test("buildBunTestArgs is the unified argv builder", () => {
      const args = buildBunTestArgs({ fast: true, bail: true });
      expect(args[0]).toBe("test");
      expect(args).toContain("--timeout");
      expect(args).toContain("--bail");
      expect(args).toContain("--isolate");
      expect(args).toContain("--parallel=4");
    });

    test("parallel worker env keys are documented in flag interactions", () => {
      expect(BUN_TEST_WORKER_ENV_KEYS).toEqual({
        bunId: "BUN_TEST_WORKER_ID",
        jestCompatId: "JEST_WORKER_ID",
      });
      expect(BUN_TEST_PARALLEL.workerEnvKeys).toBe(BUN_TEST_WORKER_ENV_KEYS);
      expect(BUN_TEST_FLAG_INTERACTIONS.parallelWorkerEnv).toContain("BUN_TEST_WORKER_ID");
      expect(BUN_TEST_FLAG_INTERACTIONS.parallelWorkerEnv).toContain("JEST_WORKER_ID");
    });

    test("buildBunTestArgBatches chunks fast unit gate", () => {
      const batches = buildBunTestArgBatches({ fast: true, bail: true });
      expect(batches.length).toBeGreaterThan(1);
      const files = batches.flatMap((batch) =>
        batch.filter((arg) => (UNIT_TEST_FILES as readonly string[]).includes(arg))
      );
      expect(files).toEqual([...UNIT_TEST_FILES]);
    });

    test("buildBunTestArgBatches returns a single batch for changed mode", () => {
      const batches = buildBunTestArgBatches({ changedRef: "HEAD", bail: true });
      expect(batches.length).toBe(1);
      expect(batches[0]).toContain("--changed=HEAD");
      expect(batches[0]).toContain("--parallel=4");
    });
  });
});
