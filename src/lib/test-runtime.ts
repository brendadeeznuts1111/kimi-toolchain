/**
 * Bun test runner env + tier grouping.
 * @see https://bun.com/docs/test/runtime-behavior#environment-variables
 * @see https://bun.com/docs/test/runtime-behavior#cli-flags-integration
 * @see https://bun.com/docs/test/runtime-behavior#global-variables
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

/** Bun test CLI flags we forward from scripts (see Bun CLI flags integration doc). */
export const FORWARDABLE_BUN_TEST_FLAGS = [
  "--smol",
  "--inspect",
  "--inspect-brk",
  "--prefer-offline",
  "--frozen-lockfile",
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
    if (arg === "--env-file") {
      const next = argv[++i];
      if (next) out.push("--env-file", next);
      continue;
    }
    if (arg.startsWith("--env-file=")) out.push(arg);
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