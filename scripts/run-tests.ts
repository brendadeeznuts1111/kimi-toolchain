#!/usr/bin/env bun
/**
 * Test runner — single source for package.json test scripts.
 *
 * Usage:
 *   bun run scripts/run-tests.ts
 *   bun run scripts/run-tests.ts --fast
 *   bun run scripts/run-tests.ts --files test/lib.unit.test.ts,test/r-score.unit.test.ts
 *   bun run scripts/run-tests.ts --coverage
 *   bun run scripts/run-tests.ts --ci --coverage
 *   bun run scripts/run-tests.ts --integration
 *   bun run scripts/run-tests.ts --smoke
 */

import { join } from "path";
import { makeDir, pathExists } from "../src/lib/bun-io.ts";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  buildBunTestArgBatches,
  parseForwardedBunTestArgs,
  runAllTestTiers,
  runBunTest,
  runTestTier,
  type RunTestTierOptions,
  type TestTier,
} from "../src/lib/test-runtime.ts";
import { resolveTestGroupFiles } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCli(): {
  tier?: TestTier;
  files: string[];
  groups: string[];
  paths: string[];
  fast: boolean;
  coverage: boolean;
  ci: boolean;
  bail: boolean | number;
  timeoutMs?: number;
  parallel?: number | boolean;
  shard?: string;
  reporterOutfile?: string;
  rerunEach?: number;
} {
  const argv = Bun.argv.slice(2);
  const files: string[] = [];
  const groups: string[] = [];
  const paths: string[] = [];
  let reporterOutfile: string | undefined;
  let timeoutMs: number | undefined;
  let parallel: number | boolean | undefined;
  let shard: string | undefined;
  let rerunEach: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--files") {
      files.push(...splitList(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("--files=")) {
      files.push(...splitList(arg.slice("--files=".length)));
      continue;
    }
    if (arg === "--group") {
      groups.push(...splitList(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("--group=")) {
      groups.push(...splitList(arg.slice("--group=".length)));
      continue;
    }
    if (arg === "--path") {
      paths.push(...splitList(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("--path=")) {
      paths.push(...splitList(arg.slice("--path=".length)));
      continue;
    }
    if (arg === "--report-file") {
      reporterOutfile = argv[++i];
      continue;
    }
    if (arg.startsWith("--report-file=")) {
      reporterOutfile = arg.slice("--report-file=".length);
      continue;
    }
    if (arg === "--timeout") {
      timeoutMs = parseInt(argv[++i] ?? "", 10);
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutMs = parseInt(arg.slice("--timeout=".length), 10);
      continue;
    }
    if (arg === "--parallel") {
      parallel = true;
      continue;
    }
    if (arg.startsWith("--parallel=")) {
      const n = parseInt(arg.slice("--parallel=".length), 10);
      parallel = Number.isNaN(n) ? true : n;
      continue;
    }
    if (arg === "--shard") {
      shard = argv[++i];
      continue;
    }
    if (arg.startsWith("--shard=")) {
      shard = arg.slice("--shard=".length);
      continue;
    }
    if (arg === "--rerun-each") {
      rerunEach = parseInt(argv[++i] ?? "", 10);
      continue;
    }
    if (arg.startsWith("--rerun-each=")) {
      rerunEach = parseInt(arg.slice("--rerun-each=".length), 10);
    }
  }

  let tier: TestTier | undefined;
  if (argv.includes("--integration")) tier = "integration";
  if (argv.includes("--smoke")) tier = "smoke";

  return {
    tier,
    files,
    groups,
    paths,
    coverage: argv.includes("--coverage"),
    ci: argv.includes("--ci"),
    fast: argv.includes("--fast"),
    bail: argv.includes("--ci") ? 10 : true,
    timeoutMs: Number.isNaN(timeoutMs) ? undefined : timeoutMs,
    parallel,
    shard,
    reporterOutfile,
    rerunEach: Number.isNaN(rerunEach) ? undefined : rerunEach,
  };
}

async function ensureArtifactDirs() {
  for (const sub of ["", "test-home", "reports"]) {
    const dir = artifactPath(REPO_ROOT, sub);
    if (!pathExists(dir)) makeDir(dir, { recursive: true });
  }
}

async function runFiles(options: ReturnType<typeof parseCli>): Promise<number> {
  const forwarded = parseForwardedBunTestArgs(Bun.argv.slice(2));
  const batches = buildBunTestArgBatches({
    files: options.files,
    coverage: options.coverage,
    ci: options.ci,
    bail: options.bail,
    timeoutMs: options.timeoutMs,
    parallel: options.parallel,
    shard: options.shard,
    reporterOutfile: options.reporterOutfile,
    rerunEach: options.rerunEach,
    dots: forwarded.includes("--dots") || Bun.argv.includes("--dots"),
    json: forwarded.includes("--json") || Bun.argv.includes("--json"),
  }).map((args) => (options.ci || options.coverage ? args : [...args, ...forwarded]));

  const quiet = Bun.argv.includes("--quiet");
  for (let i = 0; i < batches.length; i++) {
    if (batches.length > 1 && !quiet) {
      process.stderr.write(`\n[run-tests] batch ${i + 1}/${batches.length}\n`);
    }
    const code = await runBunTest(REPO_ROOT, batches[i]!, { quiet, source: "run-tests" });
    if (code !== 0) return code;
  }
  return 0;
}

async function main() {
  const options = parseCli();
  const forwarded = parseForwardedBunTestArgs(Bun.argv.slice(2));
  await ensureArtifactDirs();
  Bun.env.KIMI_TEST_HOME = artifactPath(REPO_ROOT, "test-home");

  const resolvedFiles: string[] = [];
  if (options.groups.length > 0) {
    resolvedFiles.push(...resolveTestGroupFiles(REPO_ROOT, options.groups));
  }
  if (options.paths.length > 0) {
    resolvedFiles.push(...resolveTestGroupFiles(REPO_ROOT, options.paths, { existingOnly: false }));
  }
  if (resolvedFiles.length > 0 || options.files.length > 0) {
    process.exit(await runFiles({ ...options, files: [...options.files, ...resolvedFiles] }));
  }

  const runOptions: RunTestTierOptions = {
    forwarded,
    coverage: options.coverage,
    ci: options.ci,
    bail: options.bail,
    timeoutMs: options.timeoutMs,
    parallel: options.parallel,
    shard: options.shard,
    reporterOutfile: options.reporterOutfile,
    retry: options.rerunEach,
  };

  if (options.tier) {
    process.exit(await runTestTier(REPO_ROOT, options.tier, runOptions));
  }
  if (options.fast) {
    process.exit(await runTestTier(REPO_ROOT, "unit", runOptions));
  }
  process.exit(await runAllTestTiers(REPO_ROOT, runOptions));
}

main().catch((err) => {
  console.error("run-tests failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
