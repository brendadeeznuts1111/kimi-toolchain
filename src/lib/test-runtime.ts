/**
 * Bun test runner env + tier grouping.
 * @see https://bun.com/docs/test/runtime-behavior#environment-variables
 * @see https://bun.com/docs/test/runtime-behavior#cli-flags-integration
 * @see https://bun.com/docs/test/runtime-behavior#global-variables
 * @see https://bun.com/docs/test/runtime-behavior#process-integration
 * @see https://bun.com/docs/test/runtime-behavior#signal-handling
 * @see https://bun.com/docs/test/runtime-behavior#environment-detection
 * @see https://bun.com/docs/test/runtime-behavior#performance-considerations
 * @see https://bun.com/docs/test/runtime-behavior#memory-management
 * @see https://bun.com/docs/test/runtime-behavior#test-isolation
 * @see https://bun.com/docs/test/runtime-behavior#watch-and-hot-reloading
 * @see https://bun.com/docs/test/runtime-behavior#installation-related-flags
 * @see https://bun.com/docs/test/runtime-behavior#debugging
 * @see https://bun.com/docs/test/runtime-behavior#module-loading
 * @see https://bun.com/docs/test/runtime-behavior#error-handling
 * @see https://bun.com/docs/test/runtime-behavior#promise-rejections
 * @see https://bun.com/docs/test/runtime-behavior#unhandled-errors
 * @see https://bun.com/docs/test/runtime-behavior#test-timeouts
 * @see https://bun.com/docs/test/runtime-behavior#tz-timezone
 * @see https://bun.com/docs/test/discovery#default-discovery-logic
 * @see https://bun.com/docs/test/configuration#configuration-file
 * @see https://bun.com/docs/test/writing-tests#basic-usage
 * @see https://bun.com/docs/test#run-tests
 * @see https://bun.com/reference/bun/test
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { readText } from "./bun-io.ts";
import { parseBunfigDefines } from "./build-constants-registry.ts";
import {
  CI_TEST_TIMEOUT_MS,
  DEFAULT_TEST_TIMEOUT_MS,
  FAST_TEST_TIMEOUT_MS,
  INTEGRATION_TEST_FILES,
  SMOKE_TEST_FILES,
  SMOKE_TEST_TIMEOUT_MS,
  UNIT_TEST_FILES,
} from "./test-gates.ts";

export type TestTier = "unit" | "integration" | "smoke";

export interface TestTierSpec {
  readonly tier: TestTier;
  readonly label: string;
  readonly files: readonly string[];
  readonly timeoutMs: number;
  readonly parallel?: number;
  readonly isolate: boolean;
}

/** Optional local test env (gitignored). Do not set NODE_ENV here — use buildTestRunnerEnv. */
export const TEST_ENV_FILE = ".env.test";

/** `bun:test` built-in module (@see bun.com/reference/bun/test). */
export const BUN_TEST_MODULE = {
  name: "bun:test",
  referenceUrl: "https://bun.com/reference/bun/test",
  jestCompatible: true,
  features: [
    "typescript-jsx",
    "lifecycle-hooks",
    "snapshot-testing",
    "ui-dom-testing",
    "watch-mode",
    "script-preloading",
  ],
  constExports: ["test", "describe", "expect", "expectTypeOf", "mock", "vi", "xdescribe", "xtest"],
  functionExports: [
    "beforeAll",
    "beforeEach",
    "afterAll",
    "afterEach",
    "onTestFinished",
    "setDefaultTimeout",
    "setSystemTime",
    "spyOn",
  ],
  namespaces: ["jest"],
  skipAliases: {
    xtest: "test.skip",
    xdescribe: "describe.skip",
  },
} as const;

/** How kimi-toolchain uses the bun:test module surface. */
export const BUN_TEST_MODULE_STRATEGY = {
  imports: "explicit-import-preferred-over-injected-globals",
  coreSymbols: "BUN_TEST_IMPORT_NAMES-for-standard-unit-tests",
  mocking: "mock-jest-vi-spyOn-at-boundaries-see-test-testing.md",
  types: "expectTypeOf-is-typecheck-only-run-tsc-separately",
  skipAliases: "prefer-test.skip-describe.skip-over-xtest-xdescribe",
} as const;

/** Build an explicit `bun:test` import line. */
export function buildBunTestModuleImportLine(symbols: readonly string[]): string {
  return `import { ${symbols.join(", ")} } from "${BUN_TEST_MODULE.name}";`;
}

/** `bun:test` globals Bun injects without import (explicit imports still preferred in-repo). */
export const BUN_TEST_GLOBAL_NAMES = [
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
] as const;

/** Same symbols as {@link BUN_TEST_GLOBAL_NAMES} — preferred explicit import from `bun:test`. */
export const BUN_TEST_IMPORT_NAMES = BUN_TEST_GLOBAL_NAMES;

/** Canonical explicit import line (matches Bun runtime-behavior docs). */
export const BUN_TEST_EXPLICIT_IMPORT = buildBunTestModuleImportLine(BUN_TEST_IMPORT_NAMES);

/** kimi extended import adds `mock` to the standard lifecycle/jest/vi set. */
export const KIMI_BUN_TEST_EXTENDED_SYMBOLS = [...BUN_TEST_IMPORT_NAMES, "mock"] as const;

export const KIMI_BUN_TEST_EXTENDED_IMPORT = buildBunTestModuleImportLine(
  KIMI_BUN_TEST_EXTENDED_SYMBOLS
);

/** True when every kimi core import symbol maps to a documented `bun:test` export. */
export function kimiCoreSymbolInBunTestModule(symbol: string): boolean {
  if (symbol === "it") return BUN_TEST_MODULE.constExports.includes("test");
  if (symbol === "jest") return BUN_TEST_MODULE.namespaces.includes("jest");
  return (
    (BUN_TEST_MODULE.constExports as readonly string[]).includes(symbol) ||
    (BUN_TEST_MODULE.functionExports as readonly string[]).includes(symbol)
  );
}

/** Bun writing-tests API (@see test/writing-tests#basic-usage). */
export const BUN_TEST_WRITING = {
  module: BUN_TEST_MODULE.name,
  basicSymbols: ["expect", "test"] as const,
  groupingSymbol: "describe",
  asyncStyles: ["async-await", "done-callback"] as const,
  aliases: ["test", "it"] as const,
} as const;

/** Canonical basic-usage examples from Bun writing-tests docs. */
export const BUN_TEST_WRITING_EXAMPLES = {
  basic: {
    imports: ["expect", "test"],
    name: "2 + 2",
    matcher: "toBe",
    expected: 4,
  },
  grouped: {
    imports: ["expect", "test", "describe"],
    suite: "arithmetic",
    cases: [
      { name: "2 + 2", expected: 4 },
      { name: "2 * 2", expected: 4 },
    ],
  },
  asyncAwait: {
    imports: ["expect", "test"],
    name: "2 * 2",
    expected: 4,
  },
  asyncDone: {
    imports: ["expect", "test"],
    name: "2 * 2",
    expected: 4,
  },
} as const;

/** How kimi-toolchain authors tests per writing-tests guidance. */
export const BUN_TEST_WRITING_STRATEGY = {
  imports: "explicit-from-bun:test-see-test-testing.md",
  grouping: "describe-blocks-for-related-cases",
  async: "prefer-async-await-over-done-callback",
  aliases: "test-preferred-it-accepted",
} as const;

/** Minimal import from Bun basic-usage doc. */
export const BUN_TEST_WRITING_BASIC_IMPORT = 'import { expect, test } from "bun:test";';

/** Grouped-suite import from Bun basic-usage doc. */
export const BUN_TEST_WRITING_GROUPED_IMPORT = 'import { expect, test, describe } from "bun:test";';

/** Build a `bun:test` import line for the given symbol names. */
export function buildBunTestWritingImportLine(symbols: readonly string[]): string {
  return buildBunTestModuleImportLine(symbols);
}

/** Bun `bun test` process exit codes (@see process-integration doc). */
export const BUN_TEST_EXIT = {
  ok: 0,
  /** Assertion failures; Bun 1.4 also uses 1 for module-level unhandled errors. */
  failures: 1,
} as const;

/** Bun run-tests entry (@see test#run-tests). */
export const BUN_TEST_RUN = {
  command: "bun test",
  argvToken: "test",
  singleProcess: true,
  exitsNonZeroOnFailure: true,
  preloadOrder: "preload-scripts-then-tests",
  defaultTimeoutMs: 5_000,
} as const;

/** Canonical run-tests examples from Bun test runner docs. */
export const BUN_TEST_RUN_EXAMPLES = {
  all: ["test"],
  pathFilters: ["test", "foo", "bar"],
  exactPath: ["test", "./test/specific-file.test.ts"],
  namePattern: ["test", "--test-name-pattern", "baz"],
} as const;

/** How kimi-toolchain runs tests vs bare `bun test`. */
export const BUN_TEST_RUN_STRATEGY = {
  bare: "bun-test-recursive-discovery-single-process",
  kimiFull: "package-test-scripts-test-run-runAllTestTiers",
  kimiFast: "package-test-fast-scripts-test-fast-runTestTier-unit",
  preload: "bunfig-[test].preload-before-tier-invocations",
  failure: "non-zero-exit-abort-tier-chain-on-first-failure",
  filters: "tier-explicit-files-or-bun-test---changed",
} as const;

/** package.json test script → implementation mapping (SSOT for agents). */
export const KIMI_TEST_RUN_ENTRIES = {
  all: {
    packageScript: "test",
    command: "bun run scripts/test-run.ts",
    runner: "runAllTestTiers",
  },
  fast: {
    packageScript: "test:fast",
    command: "bun run scripts/test-fast.ts",
    runner: "runTestTier",
    tier: "unit",
  },
  unit: {
    packageScript: "test:unit",
    command: "bun run scripts/test-fast.ts",
    runner: "runTestTier",
    tier: "unit",
  },
  changed: {
    packageScript: "test:changed",
    command: "bun run scripts/test-changed.ts",
    runner: "bunTestArgsForChanged",
  },
  watch: {
    packageScript: "test:watch",
    command: "NODE_ENV=test bun test --watch --isolate",
    runner: "bare-bun-test",
  },
} as const;

export function isTestRunFailure(exitCode: number): boolean {
  return exitCode !== BUN_TEST_EXIT.ok;
}

/** TZ defaults for `bun test` (@see tz-timezone). */
export const BUN_TEST_TZ = {
  defaultZone: "Etc/UTC",
  envKey: "TZ",
} as const;

export function defaultTestTimezone(env: Record<string, string | undefined> = Bun.env): string {
  const tz = env[BUN_TEST_TZ.envKey];
  return tz && tz.length > 0 ? tz : BUN_TEST_TZ.defaultZone;
}

export function applyDefaultTestTimezone(env: Record<string, string>): void {
  if (!env[BUN_TEST_TZ.envKey]) env[BUN_TEST_TZ.envKey] = BUN_TEST_TZ.defaultZone;
}

export function isUtcTimezoneOffset(offsetMinutes: number): boolean {
  return offsetMinutes === 0;
}

/** Bun per-test default when not overridden (@see test-timeouts). */
export const BUN_TEST_DEFAULT_TIMEOUT_MS = 5_000;

/** Timeout contract — global `--timeout`, per-test 3rd arg, `0`/`Infinity` disables. */
export const BUN_TEST_TIMEOUTS = {
  bunDefaultMs: BUN_TEST_DEFAULT_TIMEOUT_MS,
  globalFlag: "--timeout",
  perTestParameterIndex: 2,
  disableValues: [0, Infinity] as const,
  kimi: {
    fast: FAST_TEST_TIMEOUT_MS,
    default: DEFAULT_TEST_TIMEOUT_MS,
    ci: CI_TEST_TIMEOUT_MS,
    smoke: SMOKE_TEST_TIMEOUT_MS,
  },
} as const;

/** Canonical timeout examples from Bun test-timeouts docs. */
export const BUN_TEST_TIMEOUT_EXAMPLES = {
  global: ["test", "--timeout", "10000"],
  perTestFast: { name: "fast test", timeoutMs: 1000 },
  perTestSlow: { name: "slow test", timeoutMs: 10_000 },
  infiniteZero: 0,
  infiniteInfinity: Infinity,
} as const;

/** How kimi-toolchain applies each timeout mechanism. */
export const BUN_TEST_TIMEOUT_STRATEGY = {
  global: "tier-runners-via-bunTestArgsForTier",
  perTest: "author-third-argument-overrides-global",
  infinite: "per-test-0-or-Infinity-disables-limit",
} as const;

export function readTimeoutMsFromBunTestArgs(args: readonly string[]): number | undefined {
  const idx = args.indexOf(BUN_TEST_TIMEOUTS.globalFlag);
  if (idx < 0) return undefined;
  const raw = args[idx + 1];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function isDisabledTestTimeout(ms: number): boolean {
  return ms === 0 || ms === Infinity;
}

/** Bun default file discovery (@see test/discovery#default-discovery-logic). */
export const BUN_TEST_DISCOVERY = {
  patternDescriptions: [
    "*.test.{js|jsx|ts|tsx}",
    "*_test.{js|jsx|ts|tsx}",
    "*.spec.{js|jsx|ts|tsx}",
    "*_spec.{js|jsx|ts|tsx}",
  ],
  exclusions: ["node_modules", "hidden-directories", "non-js-like-extensions"] as const,
  testNamePatternFlag: "--test-name-pattern",
  testNamePatternShortFlag: "-t",
  /** Include tests marked with test.todo() in the run. */
  todoFlag: "--todo",
  bunfigRootKey: "root",
  executionOrder: ["files-sequential", "within-file-sequential"] as const,
} as const;

/** Canonical discovery examples from Bun finding-tests docs. */
export const BUN_TEST_DISCOVERY_EXAMPLES = {
  substringFilter: ["test", "utils"],
  exactPath: ["test", "./test/specific-file.test.ts"],
  testNamePattern: ["test", "--test-name-pattern", "addition"],
  bunfigRoot: 'root = "src"',
} as const;

/** How kimi-toolchain applies Bun test discovery mechanisms. */
export const BUN_TEST_DISCOVERY_STRATEGY = {
  defaultPatterns: "bare-bun-test-recursive-from-cwd",
  tierFiles: "explicit-paths-from-test-gates-UNIT_TEST_FILES",
  substringFilter: "positional-args-after-test-command",
  exactPath: "leading-./-or-/-disambiguates-filter",
  testNamePattern: "forward-via-script-argv",
  todo: "forward-via-script-argv--todo",
  bunfigRoot: "optional-bunfig-[test].root",
} as const;

export const BUN_TEST_DISCOVERY_VALUE_FLAGS = [
  BUN_TEST_DISCOVERY.testNamePatternFlag,
  BUN_TEST_DISCOVERY.testNamePatternShortFlag,
] as const;

/** Bun `bunfig.toml` `[test]` configuration (@see test/configuration#configuration-file). */
export const BUN_TEST_CONFIGURATION = {
  section: "[test]",
  reporterSection: "[test.reporter]",
  cliOverrideRule: "cli-flags-override-bunfig-settings",
  installInheritanceSection: "[install]",
  envFileDocExample: ".env.test",
  keys: [
    "root",
    "preload",
    "pathIgnorePatterns",
    "timeout",
    "smol",
    "concurrentTestGlob",
    "randomize",
    "seed",
    "retry",
    "rerunEach",
    "coverage",
    "coverageReporter",
    "coverageDir",
    "coverageThreshold",
    "coverageSkipTestFiles",
    "coveragePathIgnorePatterns",
    "coverageIgnoreSourcemaps",
  ],
} as const;

/** Canonical configuration examples from Bun test configuration docs. */
export const BUN_TEST_CONFIGURATION_EXAMPLES = {
  sectionHeader: "[test]",
  preload: ["./test-setup.ts", "./global-mocks.ts"],
  pathIgnorePatterns: ["vendor/**", "submodules/**"],
  timeoutMs: 10_000,
  smol: true,
  concurrentTestGlob: "**/concurrent-*.test.ts",
  coverageReporter: ["text", "lcov"],
  coverageDir: "./coverage",
  junitReporterPath: "./reports/junit.xml",
  cliOverride: ["test", "--timeout", "10000", "--coverage"],
} as const;

/** How kimi-toolchain applies Bun test configuration. */
export const BUN_TEST_CONFIGURATION_STRATEGY = {
  bunfig: "declarative-SSOT-bunfig.toml-[test]",
  preload: "bunfig-preload-tier-runners-omit-cli---preload",
  timeout: "tier-runners-pass-cli---timeout-overrides-bunfig",
  coverage: "enabled-via-script---coverage-not-bunfig-coverage-true",
  smol: "bunfig-smol-false-forward---smol-via-scripts",
  concurrentTestGlob: "bunfig-for-bare-bun-test-unit-globs",
  envFile: "auto-merge-.env.test-in-mergeBunTestInvocationArgs",
  install: "inherited-from-[install]-registry-exact-frozenLockfile",
} as const;

/** Typed `[test]` contract for kimi-toolchain bunfig.toml. */
export interface KimiBunfigTestContract {
  readonly preload: readonly string[];
  readonly concurrentTestGlob: readonly string[];
  readonly coverageSkipTestFiles: boolean;
  readonly coveragePathIgnorePatterns: readonly string[];
  readonly coverageReporter: readonly string[];
  readonly coverageDir: string;
  readonly coverageThreshold: { readonly lines: number; readonly functions: number };
  readonly smol: boolean;
}

/** Expected kimi-toolchain `[test]` settings (mirrors bunfig.toml). */
export const KIMI_BUNFIG_TEST_CONTRACT: KimiBunfigTestContract = {
  preload: ["./test/setup.ts"],
  concurrentTestGlob: ["test/*.unit.test.ts"],
  coverageSkipTestFiles: true,
  coveragePathIgnorePatterns: [
    "scripts/**",
    "src/bin/**",
    "src/lib/version.ts",
    "src/lib/memory-budget.ts",
  ],
  coverageReporter: ["text", "lcov"],
  coverageDir: "./.kimi-artifacts/coverage",
  coverageThreshold: { lines: 0.7, functions: 0.85 },
  smol: false,
} as const;

const BUN_TEST_DISCOVERY_BASENAME_RE =
  /\.(test|spec)\.(js|jsx|ts|tsx)$|_(test|spec)\.(js|jsx|ts|tsx)$/;

/** True when a path basename matches Bun's default discovery filename patterns. */
export function basenameMatchesBunTestDiscovery(basename: string): boolean {
  return BUN_TEST_DISCOVERY_BASENAME_RE.test(basename);
}

/** Doc: `./` or `/` prefix distinguishes an exact file path from a substring filter. */
export function isBunTestExactPathArg(arg: string): boolean {
  return arg.startsWith("./") || arg.startsWith("/");
}

/** Parse the `[test]` table from bunfig.toml. */
export function readBunfigTestConfig(repoRoot: string): Record<string, unknown> | undefined {
  const bunfigPath = join(repoRoot, "bunfig.toml");
  let text: string;
  try {
    text = readText(bunfigPath);
  } catch {
    return undefined;
  }
  try {
    const parsed = Bun.TOML.parse(text) as { test?: Record<string, unknown> };
    return parsed.test;
  } catch {
    return undefined;
  }
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;
}

/** Parse kimi `[test]` contract fields from a bunfig `[test]` table. */
export function parseKimiBunfigTestContract(
  test: Record<string, unknown> | undefined
): KimiBunfigTestContract | undefined {
  if (!test) return undefined;
  const preload = readStringArray(test.preload);
  const concurrentTestGlob = readStringArray(test.concurrentTestGlob);
  const coveragePathIgnorePatterns = readStringArray(test.coveragePathIgnorePatterns);
  const coverageReporter = readStringArray(test.coverageReporter);
  const coverageDir = test.coverageDir;
  const coverageSkipTestFiles = test.coverageSkipTestFiles;
  const smol = test.smol;
  const threshold = test.coverageThreshold;
  if (
    !preload ||
    !concurrentTestGlob ||
    !coveragePathIgnorePatterns ||
    !coverageReporter ||
    typeof coverageDir !== "string" ||
    typeof coverageSkipTestFiles !== "boolean" ||
    typeof smol !== "boolean" ||
    !threshold ||
    typeof threshold !== "object"
  ) {
    return undefined;
  }
  const lines = (threshold as Record<string, unknown>).lines;
  const functions = (threshold as Record<string, unknown>).functions;
  if (typeof lines !== "number" || typeof functions !== "number") return undefined;
  return {
    preload,
    concurrentTestGlob,
    coverageSkipTestFiles,
    coveragePathIgnorePatterns,
    coverageReporter,
    coverageDir,
    coverageThreshold: { lines, functions },
    smol,
  };
}

export function readKimiBunfigTestContract(repoRoot: string): KimiBunfigTestContract | undefined {
  return parseKimiBunfigTestContract(readBunfigTestConfig(repoRoot));
}

/**
 * Reporting flags from `bun test --help` (@see https://bun.com/docs/test#cli-usage).
 */
export const BUN_TEST_REPORTING = {
  reporterFlag: "--reporter",
  reporterOutfileFlag: "--reporter-outfile",
  dotsFlag: "--dots",
} as const;

export const BUN_TEST_REPORTING_FLAGS = [
  BUN_TEST_REPORTING.reporterFlag,
  BUN_TEST_REPORTING.reporterOutfileFlag,
  BUN_TEST_REPORTING.dotsFlag,
] as const;

/** How kimi-toolchain uses reporting flags. */
export const BUN_TEST_REPORTING_STRATEGY = {
  reporter: "forward-via-script-argv--reporter-junit-or-dots",
  reporterOutfile: "forward-via-script-argv--reporter-outfile",
  dots: "forward-via-script-argv--dots",
} as const;

/**
 * Coverage flags from `bun test --help` (@see https://bun.com/docs/test#cli-usage).
 */
export const BUN_TEST_COVERAGE_FLAGS = {
  coverageFlag: "--coverage",
  coverageReporterFlag: "--coverage-reporter",
  coverageDirFlag: "--coverage-dir",
} as const;

/** How kimi-toolchain uses coverage flags. */
export const BUN_TEST_COVERAGE_STRATEGY = {
  coverage: "forward-via-script-argv--coverage",
  coverageReporter: "forward-via-script-argv--coverage-reporter-text-or-lcov",
  coverageDir: "forward-via-script-argv--coverage-dir",
} as const;

/**
 * Snapshot flags from `bun test --help` (@see https://bun.com/docs/test#cli-usage).
 */
export const BUN_TEST_SNAPSHOTS = {
  updateSnapshotsFlag: "--update-snapshots",
  updateSnapshotsShortFlag: "-u",
} as const;

/** How kimi-toolchain uses snapshot flags. */
export const BUN_TEST_SNAPSHOTS_STRATEGY = {
  updateSnapshots: "forward-via-script-argv--update-snapshots-or--u",
} as const;

/**
 * Flag interaction / composition semantics (@see https://bun.com/docs/test#cli-usage).
 *
 * Bun test flags compose in specific orders — not all combinations are commutative.
 * These are the meaningful interactions documented by Bun and observed in practice.
 */
export const BUN_TEST_FLAG_INTERACTIONS = {
  /** Workers auto-isolate between files; explicit --isolate is harmless but redundant. */
  parallelIsolate: "--parallel implies --isolate per worker",
  /** Import-graph filter applied before shard distribution. */
  changedShard: "--shard splits after --changed filter",
  /** Randomization applied within each shard after distribution. */
  shardRandomize: "--randomize shuffles within the shard",
  /** --changed --watch re-queries git on every restart; any .ts edit triggers re-run. */
  changedWatch: "--changed --watch re-filters on restart; broader trigger than file-scoped --watch",
  /** --parallel forwards transpiler/resolver flags to workers automatically. */
  parallelTranspile:
    "--parallel inherits --define --loader --tsconfig-override --conditions --env-file",
  /** --parallel sets BUN_TEST_WORKER_ID (1-based) and JEST_WORKER_ID in each worker. */
  parallelWorkerEnv: "--parallel sets BUN_TEST_WORKER_ID and JEST_WORKER_ID in worker env",
  /** --bail exits the entire run after N failures across all workers. */
  bailParallel: "--bail N with --parallel exits after N failures across workers",
  /** --concurrent runs tests concurrently within each worker file. */
  concurrentParallel: "--concurrent applies within each --parallel worker",
  /** Bare --changed exits 0 when no changed files; --changed --watch stays alive. */
  changedNoop: "bare --changed exits cleanly on no changes; --changed --watch keeps running",
  /** --isolate drains microtasks, closes sockets, kills subprocesses between files. */
  isolateCleanup:
    "--isolate resets globals drains timers closes sockets kills children between files",
  /** --watch auto-isolates; explicit --isolate accepted but no-op. */
  watchIsolate: "--watch implicitly isolates; explicit --isolate is redundant",
  /** --seed implies --randomize; same seed produces identical order. */
  seedRandomize: "--seed N implies --randomize with reproducible order",
  /** --preload scripts execute before each isolated file; isolation doesn't skip preload. */
  isolatePreload: "--isolate with bunfig [test].preload works as expected; preloads fire per file",
  /** Coverage aggregates across parallel workers into a single report. */
  coverageParallel: "--coverage with --parallel merges profiles from all workers",
  /** --retry N retries failed tests within each worker before reporting. */
  retryParallel: "--retry N with --parallel retries per-worker before aggregation",
} as const;

/** Read optional `[test].root` from bunfig.toml (discovery scan root). */
export function readBunfigTestRoot(repoRoot: string): string | undefined {
  const root = readBunfigTestConfig(repoRoot)?.root;
  return typeof root === "string" ? root : undefined;
}

/** Read numeric `[test].timeout` default from bunfig.toml (milliseconds). */
export function readBunfigTestTimeoutMs(repoRoot: string): number | undefined {
  const timeout = readBunfigTestConfig(repoRoot)?.timeout;
  return typeof timeout === "number" && Number.isFinite(timeout) ? timeout : undefined;
}

/** Extract `--test-name-pattern` / `-t` flags forwarded from script argv. */
export function parseForwardedDiscoveryArgs(argv: readonly string[]): string[] {
  const all = parseForwardedBunTestArgs(argv);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const arg = all[i]!;
    const flag = (BUN_TEST_DISCOVERY_VALUE_FLAGS as readonly string[]).find(
      (entry) => arg === entry || arg.startsWith(`${entry}=`)
    );
    if (!flag) continue;
    out.push(arg);
    if (arg === flag) {
      const next = all[i + 1];
      if (next && !next.startsWith("-")) {
        out.push(next);
        i += 1;
      }
    }
  }
  return out;
}

/** Non-zero when tests failed or the runner reported errors. */
export function isBunTestFailureExit(code: number): boolean {
  return code !== BUN_TEST_EXIT.ok;
}

/**
 * Doc: exit &gt; 1 equals unhandled-error count. Bun 1.4-canary still exits 1 for
 * module-level unhandled errors — use stderr error count when distinguishing.
 */
export function isUnhandledErrorExitCode(code: number): boolean {
  return code > BUN_TEST_EXIT.failures;
}

export function describeBunTestExitCode(code: number): string {
  if (code === BUN_TEST_EXIT.ok) return "all passed";
  if (code === BUN_TEST_EXIT.failures) return "failures or runner errors";
  return `unhandled errors (${code})`;
}

/**
 * Error handling umbrella (@see error-handling).
 * Bun tracks rejections and inter-test errors; kimi uses the built-in runner (no custom handlers in preload).
 */
export const BUN_TEST_ERROR_HANDLING = {
  runnerBanner: "Unhandled error between tests",
  failsDespitePassingTests: true,
  customHandlerEvents: ["uncaughtException", "unhandledRejection"] as const,
  /** test/setup.ts relies on Bun runner tracking instead of process.on handlers. */
  kimiUsesBunRunnerTracking: true,
} as const;

/** Inter-test throws (@see unhandled-errors). */
export const BUN_TEST_UNHANDLED_ERRORS = {
  docPattern: 'setTimeout(() => { throw new Error("Unhandled error"); }, 0)',
  failsDespitePassingTests: true,
} as const;

/**
 * Promise rejections outside test callbacks (@see promise-rejections).
 * Bun fails the run even when registered tests pass.
 */
export const BUN_TEST_PROMISE_REJECTIONS = {
  docPattern: 'Promise.reject(new Error("Unhandled rejection"))',
  runnerBanner: BUN_TEST_ERROR_HANDLING.runnerBanner,
  failsDespitePassingTests: true,
} as const;

/** Canonical custom handler pattern from Bun docs (optional; not used in kimi preload). */
export const BUN_TEST_CUSTOM_ERROR_HANDLERS = [
  'process.on("uncaughtException", (error) => { ... })',
  'process.on("unhandledRejection", (reason, promise) => { ... })',
] as const;

export function isRunnerErrorHandlingExit(code: number): boolean {
  return isBunTestFailureExit(code);
}

/** Detect Bun runner output for module-level unhandled promise rejections. */
export function isRunnerPromiseRejectionOutput(output: string): boolean {
  return (
    output.includes(BUN_TEST_ERROR_HANDLING.runnerBanner) && /Unhandled rejection/i.test(output)
  );
}

/** Detect runner output for inter-test throws (banner or surfaced error text). */
export function isRunnerUnhandledErrorOutput(output: string): boolean {
  return (
    output.includes(BUN_TEST_ERROR_HANDLING.runnerBanner) ||
    (/Unhandled error/i.test(output) && !/Unhandled rejection/i.test(output))
  );
}

/** Non-zero exit when the runner reported promise-rejection errors. */
export function isPromiseRejectionRunnerExit(code: number): boolean {
  return isRunnerErrorHandlingExit(code);
}

/** Signals the Bun test runner handles (@see signal-handling). */
export const BUN_TEST_SIGNALS = {
  gracefulStop: "SIGTERM",
  immediateStop: "SIGKILL",
} as const;

/** Env vars Bun reads for CI / GitHub Actions (@see environment-detection). */
export const BUN_TEST_DETECTION_ENV_KEYS = ["CI", "GITHUB_ACTIONS"] as const;

export function isBunCiDetectionEnv(env: Record<string, string | undefined>): boolean {
  const ci = env.CI;
  const gha = env.GITHUB_ACTIONS;
  return ci === "true" || ci === "1" || gha === "true" || gha === "1";
}

/** JUnit / annotation-friendly reporter when CI env is detected. */
export function shouldEmitCiTestReporter(env: Record<string, string | undefined>): boolean {
  return isBunCiDetectionEnv(env);
}

export function preservesBunDetectionEnv(
  built: Record<string, string>,
  parent: Record<string, string | undefined> = Bun.env
): boolean {
  for (const key of BUN_TEST_DETECTION_ENV_KEYS) {
    const parentVal = parent[key];
    if (parentVal === undefined) continue;
    if (built[key] !== parentVal) return false;
  }
  return true;
}

/** Memory management (@see memory-management). */
export const BUN_TEST_MEMORY = {
  lowMemoryFlag: "--smol",
  packageScript: "test:smol",
  /** kimi splits large suites by {@link TEST_TIER_ORDER} instead of path globs. */
  splitStrategy: "tier" as const,
} as const;

/** Test isolation in Bun's single-process runner (@see test-isolation). */
export const BUN_TEST_ISOLATION = {
  fileIsolationFlag: "--isolate",
  lifecycleHook: "afterEach",
  moduleResetCall: "jest.resetModules()",
  /** Isolated HOME for unit tests — set in preload; use test/helpers `withIsolatedHome`. */
  homeEnvKey: "KIMI_TEST_HOME",
} as const;

/** Canonical afterEach cleanup pattern from Bun docs (explicit import preferred in-repo). */
export const BUN_TEST_ISOLATION_AFTER_EACH_IMPORT = 'import { afterEach } from "bun:test";';

/** kimi posture vs Bun single-process defaults (@see performance-considerations). */
export const BUN_TEST_PERFORMANCE = {
  lowMemoryFlag: BUN_TEST_MEMORY.lowMemoryFlag,
  isolationFlag: BUN_TEST_ISOLATION.fileIsolationFlag,
  /** Bun default; kimi splits unit → integration → smoke via {@link TEST_TIER_ORDER}. */
  singleProcessDefault: true,
} as const;

export function bunTestArgsIncludeFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

export function tierUsesFileIsolation(spec: TestTierSpec): boolean {
  return spec.isolate;
}

/**
 * Watch / hot reload (@see watch-and-hot-reloading).
 * `--watch` / `--hot` are root Bun CLI flags (see `bun --help`), not `bun test --help`.
 */
export const BUN_TEST_WATCH = {
  watchFlag: "--watch",
  hotFlag: "--hot",
  /** Bun recommends `--watch` over `--hot` for isolation between runs. */
  preferredMode: "watch" as const,
  packageScripts: {
    all: "test:watch",
    changed: "test:changed:watch",
  },
} as const;

/**
 * Args for interactive watch loops — direct `bun test`, not tier batch runners.
 * Re-runs only tests affected by changed imports (Bun import graph).
 */
export function bunTestWatchArgs(
  options: {
    changedRef?: string;
    files?: readonly string[];
    isolate?: boolean;
    useHot?: boolean;
  } = {}
): string[] {
  const args = ["test"];
  if (options.changedRef) args.push(`--changed=${options.changedRef}`);
  if (options.files?.length) args.push(...options.files);
  args.push(options.useHot ? BUN_TEST_WATCH.hotFlag : BUN_TEST_WATCH.watchFlag);
  if (options.isolate !== false) args.push(BUN_TEST_ISOLATION.fileIsolationFlag);
  return args;
}

export function isBunTestWatchMode(args: readonly string[]): boolean {
  return bunTestArgsIncludeFlag(args, BUN_TEST_WATCH.watchFlag);
}

export function isBunTestHotMode(args: readonly string[]): boolean {
  return bunTestArgsIncludeFlag(args, BUN_TEST_WATCH.hotFlag);
}

/**
 * `--changed` flag for git-aware test filtering (@see https://bun.com/docs/test#cli-usage).
 *
 * Bun builds the import graph of test files and runs only those that transitively depend
 * on a file git reports as changed. Composes with `--watch` and `--shard`.
 *
 * Graph analysis scans imports without entering `node_modules` and without linking or
 * emitting code, so overhead is minimal.
 *
 * - Bare `--changed`        — uncommitted changes (unstaged + staged + untracked).
 *                             Exits cleanly (0) if no changed files found.
 * - `--changed=<ref>`       — changes since a commit, branch, or tag.
 *                             Exits cleanly (0) if no changed files found.
 * - `--changed --watch`     — re-filter on every restart; editing any local source file
 *                             triggers a re-run even if not in the current filtered set.
 *                             **Stays alive** when no changed files are found (unlike bare).
 *
 * @see BUN_TEST_EXECUTION_STRATEGY
 */
export const BUN_TEST_CHANGED = {
  changedFlag: "--changed",
  bareFilter: "--changed",
  valuePrefix: "--changed=",
  /** Default behavior: work-tree diff (unstaged + staged + untracked). */
  defaultScope: "working-tree-diff",
  /** `--changed --watch`: re-filter on every restart, tracks live working tree. */
  composeWatch: "re-filter-on-restart-live-working-tree",
  /** No changed files: --watch keeps the process alive; bare --changed exits cleanly. */
  noChangesBehavior: "with-watch-stays-alive-without-watch-exits-0",
} as const;

export const BUN_TEST_CHANGED_FLAGS = [
  BUN_TEST_CHANGED.changedFlag,
  BUN_TEST_CHANGED.valuePrefix,
] as const;

/** How kimi-toolchain applies the --changed filter. */
export const BUN_TEST_CHANGED_STRATEGY = {
  script: "bun-run-test-changed-or-forward-via-script-argv",
  compose: "shard-after-changed-randomize-after-shard",
  bare: "uncommitted-changes-staged-unstaged-untracked",
  explicit: "--changed=ref-branch-or-commit",
  watch: "--changed---watch-re-filter-every-restart",
} as const;

/**
 * `--parallel` worker semantics for `bun test`.
 *
 * `--parallel[=N]` distributes test files across up to N worker processes (defaults
 * to CPU count). Workers auto-isolate between files and inherit all transpiler/resolver
 * flags (`--define`, `--loader`, `--tsconfig-override`, `--conditions`, etc.).
 *
 * Composes with: `--bail`, `--randomize`, `--dots`, `--reporter=junit`, `--coverage`,
 * snapshots, and `--changed` (import graph built on coordinator, distributed to workers).
 *
 * @see BUN_TEST_WORKER_ENV_KEYS
 * @see https://bun.com/docs/test#cli-usage
 */
export const BUN_TEST_PARALLEL = {
  parallelFlag: "--parallel",
  parallelAssignFlag: "--parallel=",
  autoIsolate: true,
  composedFlags: "all-transpiler-resolver-and-execution-flags" as const,
  workerEnvKeys: {
    bunId: "BUN_TEST_WORKER_ID",
    jestCompatId: "JEST_WORKER_ID",
  } as const,
} as const;

/**
 * Installation-related flags for `bun test` (@see installation-related-flags).
 * Affect network requests and auto-installs during test execution.
 */
export const BUN_TEST_INSTALL = {
  preferOfflineFlag: "--prefer-offline",
  frozenLockfileFlag: "--frozen-lockfile",
  /** Repo bunfig.toml [install].frozenLockfile — merged with CLI flags at runtime. */
  bunfigFrozenLockfileKey: "frozenLockfile",
} as const;

export const BUN_TEST_INSTALL_FLAGS = [
  BUN_TEST_INSTALL.preferOfflineFlag,
  BUN_TEST_INSTALL.frozenLockfileFlag,
] as const;

export function isBunTestInstallFlag(
  flag: string
): flag is (typeof BUN_TEST_INSTALL_FLAGS)[number] {
  return (BUN_TEST_INSTALL_FLAGS as readonly string[]).includes(flag);
}

export function parseForwardedInstallFlags(argv: readonly string[]): string[] {
  return parseForwardedBunTestArgs(argv).filter(isBunTestInstallFlag);
}

/** Debugger attachment flags (@see debugging). Root Bun CLI flags — see `bun --help`. */
export const BUN_TEST_DEBUG = {
  inspectFlag: "--inspect",
  inspectBrkFlag: "--inspect-brk",
  packageScript: "test:debug",
} as const;

export const BUN_TEST_DEBUG_FLAGS = [
  BUN_TEST_DEBUG.inspectFlag,
  BUN_TEST_DEBUG.inspectBrkFlag,
] as const;

export function isBunTestDebugFlag(flag: string): flag is (typeof BUN_TEST_DEBUG_FLAGS)[number] {
  return (BUN_TEST_DEBUG_FLAGS as readonly string[]).includes(flag);
}

export function parseForwardedDebugFlags(argv: readonly string[]): string[] {
  return parseForwardedBunTestArgs(argv).filter(isBunTestDebugFlag);
}

/** Args for attaching a debugger to the test runner process. */
export function bunTestDebugArgs(
  options: { breakOnStart?: boolean; isolate?: boolean } = {}
): string[] {
  const args = [
    "test",
    options.breakOnStart ? BUN_TEST_DEBUG.inspectBrkFlag : BUN_TEST_DEBUG.inspectFlag,
  ];
  if (options.isolate !== false) args.push(BUN_TEST_ISOLATION.fileIsolationFlag);
  return args;
}

/** Module-loading flags (@see module-loading). */
export const BUN_TEST_MODULE_LOADING = {
  preloadFlag: "--preload",
  defineFlag: "--define",
  loaderFlag: "--loader",
  tsconfigOverrideFlag: "--tsconfig-override",
  conditionsFlag: "--conditions",
  envFileFlag: "--env-file",
  /** Declarative SSOT: bunfig.toml [test].preload */
  bunfigPreloadRelPath: "./test/setup.ts",
  defaultEnvFile: TEST_ENV_FILE,
  defineRegistry: "bunfig.toml [define]",
} as const;

/** Canonical `bun test` argv slices from Bun module-loading docs. */
export const BUN_TEST_MODULE_LOADING_EXAMPLES = {
  preload: ["test", "--preload", "./setup.ts"],
  define: ["test", "--define", "process.env.API_URL='http://localhost:3000'"],
  loader: ["test", "--loader", ".special:special-loader"],
  tsconfigOverride: ["test", "--tsconfig-override", "./test-tsconfig.json"],
  conditions: ["test", "--conditions", "development"],
  envFile: ["test", "--env-file", TEST_ENV_FILE],
} as const;

/** How kimi-toolchain applies each module-loading mechanism. */
export const BUN_TEST_MODULE_LOADING_STRATEGY = {
  preload: "bunfig-[test].preload",
  define: "bunfig-[define]-plus-installBuildConstantGlobals",
  envFile: "auto-merge-.env.test",
  loader: "forward-via-script-argv",
  tsconfigOverride: "forward-via-script-argv",
  conditions: "forward-via-script-argv",
} as const;

/** Module-loading flags that take a value (flag + token or --flag=value). */
export const BUN_TEST_MODULE_LOADING_VALUE_FLAGS = [
  BUN_TEST_MODULE_LOADING.preloadFlag,
  BUN_TEST_MODULE_LOADING.defineFlag,
  BUN_TEST_MODULE_LOADING.loaderFlag,
  BUN_TEST_MODULE_LOADING.tsconfigOverrideFlag,
  BUN_TEST_MODULE_LOADING.conditionsFlag,
  BUN_TEST_MODULE_LOADING.envFileFlag,
] as const;

/** Read [test].preload paths from bunfig.toml (declarative preload SSOT). */
export function readBunfigTestPreloadPaths(repoRoot: string): string[] {
  return readStringArray(readBunfigTestConfig(repoRoot)?.preload) ?? [];
}

export function resolveKimiTestPreloadPath(repoRoot: string): string {
  const paths = readBunfigTestPreloadPaths(repoRoot);
  return paths[0] ?? BUN_TEST_MODULE_LOADING.bunfigPreloadRelPath;
}

/** Extract module-loading flags (and values) forwarded from script argv. */
export function parseForwardedModuleLoadingArgs(argv: readonly string[]): string[] {
  const all = parseForwardedBunTestArgs(argv);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const arg = all[i]!;
    const flag = (BUN_TEST_MODULE_LOADING_VALUE_FLAGS as readonly string[]).find(
      (entry) => arg === entry || arg.startsWith(`${entry}=`)
    );
    if (!flag) continue;
    out.push(arg);
    if (arg === flag) {
      const next = all[i + 1];
      if (next && !next.startsWith("--")) {
        out.push(next);
        i += 1;
      }
    }
  }
  return out;
}

/** Bun test CLI flags we forward from scripts (see Bun CLI flags integration doc). */
export const FORWARDABLE_BUN_TEST_FLAGS = [
  "--smol",
  ...BUN_TEST_DEBUG_FLAGS,
  ...BUN_TEST_INSTALL_FLAGS,
] as const;

/** Ordered tiers for `bun run test` — unit → integration → smoke. */
export const TEST_TIER_ORDER: readonly TestTier[] = ["unit", "integration", "smoke"] as const;

export const TEST_TIER_SPECS: Record<TestTier, TestTierSpec> = {
  unit: {
    tier: "unit",
    label: "unit",
    files: UNIT_TEST_FILES,
    timeoutMs: FAST_TEST_TIMEOUT_MS,
    parallel: 4,
    isolate: true,
  },
  integration: {
    tier: "integration",
    label: "integration",
    files: INTEGRATION_TEST_FILES,
    timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    isolate: true,
  },
  smoke: {
    tier: "smoke",
    label: "smoke",
    files: SMOKE_TEST_FILES,
    timeoutMs: SMOKE_TEST_TIMEOUT_MS,
    isolate: true,
  },
};

const NODE_ENV_DOC = "https://bun.com/docs/test/runtime-behavior#node_env";
const CLI_FLAGS_DOC = "https://bun.com/docs/test/runtime-behavior#cli-flags-integration";
const BUILD_CONSTANT_PROBE_KEY = "KIMI_TUNING_SET_VERSION";

let nodeEnvWarned = false;
let envFileNodeEnvWarned = false;

/** Test-only: reset warn-once guard between unit tests. */
export function resetTestRuntimeWarningsForTests(): void {
  nodeEnvWarned = false;
  envFileNodeEnvWarned = false;
}

/** Warn once when test runtime inherited a non-test NODE_ENV from the parent shell. */
export function warnIfNodeEnvNotTest(source: string): void {
  if (nodeEnvWarned) return;
  const prior = Bun.env.NODE_ENV;
  if (!prior || prior === "test") return;
  nodeEnvWarned = true;
  process.stderr.write(
    `⚠ [${source}] NODE_ENV was "${prior}" — forcing "test" (${NODE_ENV_DOC})\n`
  );
}

/**
 * Mirror bunfig `[define]` onto globalThis when the probe key is absent.
 * Compile-time defines do not populate globalThis; some workers need the runtime mirror.
 */
export function installBuildConstantGlobals(repoRoot: string): void {
  const globals = globalThis as Record<string, unknown>;
  if (globals[BUILD_CONSTANT_PROBE_KEY] !== undefined) return;

  const bunfigPath = join(repoRoot, "bunfig.toml");
  let text: string;
  try {
    text = readText(bunfigPath);
  } catch {
    return;
  }
  if (!text.includes("[define]")) return;

  for (const entry of parseBunfigDefines(text)) {
    globals[entry.key] = entry.value;
  }
}

/** Warn if .env.test sets NODE_ENV — Bun would honor it over auto-test semantics. */
export function warnIfTestEnvFileSetsNodeEnv(repoRoot: string): void {
  if (envFileNodeEnvWarned) return;
  const path = join(repoRoot, TEST_ENV_FILE);
  if (!pathExists(path)) return;
  let text: string;
  try {
    text = readText(path);
  } catch {
    return;
  }
  const match = text.match(/^\s*NODE_ENV\s*=\s*(\S+)/m);
  if (!match || match[1] === "test") return;
  envFileNodeEnvWarned = true;
  process.stderr.write(
    `⚠ [${TEST_ENV_FILE}] NODE_ENV=${match[1]} — remove it; kimi-toolchain forces test mode (${CLI_FLAGS_DOC})\n`
  );
}

/**
 * Forward `bun test` flags from script argv:
 *   bun run scripts/test-fast.ts -- --smol
 *   bun run scripts/test-fast.ts --inspect
 */
function pushValueFlag(out: string[], flag: string, value: string | undefined): void {
  if (value) out.push(flag, value);
}

const FORWARDABLE_BUN_TEST_VALUE_FLAGS = [
  ...BUN_TEST_MODULE_LOADING_VALUE_FLAGS,
  ...BUN_TEST_DISCOVERY_VALUE_FLAGS,
] as const;

function isForwardedValueFlag(arg: string): boolean {
  return (
    (FORWARDABLE_BUN_TEST_VALUE_FLAGS as readonly string[]).includes(arg) ||
    (FORWARDABLE_BUN_TEST_VALUE_FLAGS as readonly string[]).some((flag) =>
      arg.startsWith(`${flag}=`)
    )
  );
}

export function parseForwardedBunTestArgs(argv: readonly string[]): string[] {
  const dash = argv.indexOf("--");
  if (dash >= 0) return argv.slice(dash + 1).filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((FORWARDABLE_BUN_TEST_FLAGS as readonly string[]).includes(arg)) {
      out.push(arg);
      continue;
    }
    if (isForwardedValueFlag(arg)) {
      for (const flag of FORWARDABLE_BUN_TEST_VALUE_FLAGS) {
        if (arg === flag) {
          pushValueFlag(out, flag, argv[++i]);
          break;
        }
        if (arg.startsWith(`${flag}=`)) {
          out.push(arg);
          break;
        }
      }
    }
  }
  return out;
}

export function defaultTestEnvFileArgs(repoRoot: string, forwarded: readonly string[]): string[] {
  if (forwarded.some((arg) => arg === "--env-file" || arg.startsWith("--env-file="))) {
    return [];
  }
  const path = join(repoRoot, TEST_ENV_FILE);
  if (!pathExists(path)) return [];
  return ["--env-file", TEST_ENV_FILE];
}

export function mergeBunTestInvocationArgs(
  base: string[],
  repoRoot: string,
  forwarded: readonly string[] = []
): string[] {
  warnIfTestEnvFileSetsNodeEnv(repoRoot);
  return [...base, ...defaultTestEnvFileArgs(repoRoot, forwarded), ...forwarded];
}

/**
 * Bun sets NODE_ENV=test when `bun test` is invoked directly, but skips that when
 * NODE_ENV is already set on the parent process. Scripted spawns must force it.
 */
export function buildTestRunnerEnv(
  extra: Record<string, string | undefined> = {},
  source = "buildTestRunnerEnv"
): Record<string, string> {
  warnIfNodeEnvNotTest(source);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = "test";
  applyDefaultTestTimezone(env);
  return env;
}

export function bunTestArgsForTier(
  spec: TestTierSpec,
  options: { repoRoot?: string; forwarded?: readonly string[] } = {}
): string[] {
  const args = ["test", "--timeout", String(spec.timeoutMs)];
  if (spec.isolate) args.push("--isolate");
  if (spec.parallel !== undefined) args.push("--parallel", String(spec.parallel));
  args.push(...spec.files);
  if (options.repoRoot) {
    return mergeBunTestInvocationArgs(args, options.repoRoot, options.forwarded ?? []);
  }
  return args;
}

export function bunTestArgsForChanged(
  changedRef: string,
  options: {
    timeoutMs?: number;
    repoRoot?: string;
    forwarded?: readonly string[];
  } = {}
): string[] {
  const args = [
    "test",
    `--changed=${changedRef}`,
    "--timeout",
    String(options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS),
    "--isolate",
    "--parallel",
  ];
  if (options.repoRoot) {
    return mergeBunTestInvocationArgs(args, options.repoRoot, options.forwarded ?? []);
  }
  return args;
}

export async function runBunTest(
  repoRoot: string,
  args: string[],
  options: { quiet?: boolean; source?: string } = {}
): Promise<number> {
  const quiet = options.quiet ?? false;
  const proc = Bun.spawn(["bun", ...args], {
    cwd: repoRoot,
    stdout: quiet ? "pipe" : "inherit",
    stderr: quiet ? "pipe" : "inherit",
    env: buildTestRunnerEnv({}, options.source ?? "runBunTest"),
  });
  return await proc.exited;
}

export async function runTestTier(
  repoRoot: string,
  tier: TestTier,
  options: { quiet?: boolean; forwarded?: readonly string[] } = {}
): Promise<number> {
  const spec = TEST_TIER_SPECS[tier];
  const forwarded = options.forwarded ?? parseForwardedBunTestArgs(Bun.argv.slice(2));
  const quiet = options.quiet ?? false;
  if (!quiet) {
    process.stderr.write(`\n[test] tier=${spec.label} files=${spec.files.length}\n`);
    if (forwarded.length > 0) {
      process.stderr.write(`[test] forwarded: ${forwarded.join(" ")}\n`);
    }
  }
  const args = bunTestArgsForTier(spec, { repoRoot, forwarded });
  return runBunTest(repoRoot, args, { quiet, source: `test:${spec.label}` });
}

export async function runAllTestTiers(
  repoRoot: string,
  options: { forwarded?: readonly string[] } = {}
): Promise<number> {
  const forwarded = options.forwarded ?? parseForwardedBunTestArgs(Bun.argv.slice(2));
  for (const tier of TEST_TIER_ORDER) {
    const code = await runTestTier(repoRoot, tier, { forwarded });
    if (isTestRunFailure(code)) return code;
  }
  return 0;
}
