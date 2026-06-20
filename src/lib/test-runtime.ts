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
 */

import { existsSync } from "fs";
import { join } from "path";
import { readText } from "./bun-io.ts";
import { parseBunfigDefines } from "./build-constants-registry.ts";
import {
  CI_TEST_TIMEOUT_MS,
  DEFAULT_TEST_TIMEOUT_MS,
  INTEGRATION_TEST_FILES,
  SMOKE_TEST_FILES,
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
export const BUN_TEST_EXPLICIT_IMPORT =
  'import { test, it, describe, expect, beforeAll, beforeEach, afterAll, afterEach, jest, vi } from "bun:test";';

/** Bun `bun test` process exit codes (@see process-integration doc). */
export const BUN_TEST_EXIT = {
  ok: 0,
  /** Assertion failures; Bun 1.4 also uses 1 for module-level unhandled errors. */
  failures: 1,
} as const;

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
 * Promise rejections outside test callbacks (@see promise-rejections).
 * Bun fails the run even when registered tests pass.
 */
export const BUN_TEST_PROMISE_REJECTIONS = {
  docPattern: 'Promise.reject(new Error("Unhandled rejection"))',
  runnerBanner: "Unhandled error between tests",
  failsDespitePassingTests: true,
} as const;

/** Detect Bun runner output for module-level unhandled promise rejections. */
export function isRunnerPromiseRejectionOutput(output: string): boolean {
  return (
    output.includes(BUN_TEST_PROMISE_REJECTIONS.runnerBanner) &&
    /Unhandled rejection/i.test(output)
  );
}

/** Non-zero exit when the runner reported promise-rejection errors. */
export function isPromiseRejectionRunnerExit(code: number): boolean {
  return isBunTestFailureExit(code);
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
  parent: Record<string, string | undefined> = process.env
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
export const BUN_TEST_ISOLATION_AFTER_EACH_IMPORT =
  'import { afterEach } from "bun:test";';

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

export function isBunTestInstallFlag(flag: string): flag is (typeof BUN_TEST_INSTALL_FLAGS)[number] {
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
  const bunfigPath = join(repoRoot, "bunfig.toml");
  let text: string;
  try {
    text = readText(bunfigPath);
  } catch {
    return [];
  }
  const section = text.match(/\[test\][\s\S]*?(?=\n\[|\n*$)/);
  if (!section) return [];
  const preload = section[0].match(/preload\s*=\s*\[([^\]]*)\]/);
  if (!preload) return [];
  return [...preload[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
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
    timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
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
    timeoutMs: CI_TEST_TIMEOUT_MS,
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
  const prior = process.env.NODE_ENV;
  if (!prior || prior === "test") return;
  nodeEnvWarned = true;
  console.warn(
    `⚠ [${source}] NODE_ENV was "${prior}" — forcing "test" (${NODE_ENV_DOC})`
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
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readText(path);
  } catch {
    return;
  }
  const match = text.match(/^\s*NODE_ENV\s*=\s*(\S+)/m);
  if (!match || match[1] === "test") return;
  envFileNodeEnvWarned = true;
  console.warn(
    `⚠ [${TEST_ENV_FILE}] NODE_ENV=${match[1]} — remove it; kimi-toolchain forces test mode (${CLI_FLAGS_DOC})`
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

function isModuleLoadingValueFlag(arg: string): boolean {
  return (
    (BUN_TEST_MODULE_LOADING_VALUE_FLAGS as readonly string[]).includes(arg) ||
    (BUN_TEST_MODULE_LOADING_VALUE_FLAGS as readonly string[]).some((flag) =>
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
    if (isModuleLoadingValueFlag(arg)) {
      for (const flag of BUN_TEST_MODULE_LOADING_VALUE_FLAGS) {
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

export function defaultTestEnvFileArgs(
  repoRoot: string,
  forwarded: readonly string[]
): string[] {
  if (forwarded.some((arg) => arg === "--env-file" || arg.startsWith("--env-file="))) {
    return [];
  }
  const path = join(repoRoot, TEST_ENV_FILE);
  if (!existsSync(path)) return [];
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
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = "test";
  if (!env.TZ) env.TZ = "Etc/UTC";
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
    if (code !== 0) return code;
  }
  return 0;
}