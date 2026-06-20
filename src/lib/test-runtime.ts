/**
 * Bun test runner env + tier grouping.
 * @see https://bun.com/docs/test/runtime-behavior#environment-variables
 */

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

/**
 * Bun sets NODE_ENV=test when `bun test` is invoked directly, but skips that when
 * NODE_ENV is already set on the parent process. Scripted spawns must force it.
 */
export function buildTestRunnerEnv(
  extra: Record<string, string | undefined> = {}
): Record<string, string> {
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

export function bunTestArgsForTier(spec: TestTierSpec): string[] {
  const args = ["test", "--timeout", String(spec.timeoutMs)];
  if (spec.isolate) args.push("--isolate");
  if (spec.parallel !== undefined) args.push("--parallel", String(spec.parallel));
  args.push(...spec.files);
  return args;
}

export async function runTestTier(
  repoRoot: string,
  tier: TestTier,
  options: { quiet?: boolean } = {}
): Promise<number> {
  const spec = TEST_TIER_SPECS[tier];
  const quiet = options.quiet ?? false;
  if (!quiet) {
    process.stderr.write(`\n[test] tier=${spec.label} files=${spec.files.length}\n`);
  }
  const proc = Bun.spawn(bunTestArgsForTier(spec), {
    cwd: repoRoot,
    stdout: quiet ? "pipe" : "inherit",
    stderr: quiet ? "pipe" : "inherit",
    env: buildTestRunnerEnv(),
  });
  return await proc.exited;
}

export async function runAllTestTiers(repoRoot: string): Promise<number> {
  for (const tier of TEST_TIER_ORDER) {
    const code = await runTestTier(repoRoot, tier);
    if (code !== 0) return code;
  }
  return 0;
}