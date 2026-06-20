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
 *
 * Note: Bun 1.3.14 has no `bun test --config=ci`; CI settings are explicit flags
 * plus bunfig.toml [test] defaults (concurrentTestGlob, coverageThreshold).
 *
 * @see https://bun.com/docs/guides/test/bail
 */

import { existsSync, mkdirSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { artifactPath } from "../src/lib/artifacts.ts";
import { bunTestArgBatches } from "../src/lib/test-gates.ts";
import {
  buildTestRunnerEnv,
  mergeBunTestInvocationArgs,
  parseForwardedBunTestArgs,
} from "../src/lib/test-runtime.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseCli(): {
  fast: boolean;
  coverage: boolean;
  ci: boolean;
  smoke: boolean;
  integration: boolean;
  files: string[];
  reporterOutfile?: string;
  timeoutMs?: number;
  parallel?: number | boolean;
  shard?: string;
} {
  const argv = Bun.argv.slice(2);
  const files: string[] = [];
  let reporterOutfile: string | undefined;
  let timeoutMs: number | undefined;
  let parallel: number | boolean | undefined;
  let shard: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--files") {
      files.push(...splitList(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("--files=")) {
      files.push(...splitList(arg.slice("--files=".length)));
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
    }
  }
  return {
    fast: argv.includes("--fast"),
    coverage: argv.includes("--coverage"),
    ci: argv.includes("--ci"),
    smoke: argv.includes("--smoke"),
    integration: argv.includes("--integration"),
    files,
    reporterOutfile,
    timeoutMs,
    parallel,
    shard,
  };
}

async function main() {
  const {
    fast,
    coverage,
    ci,
    smoke,
    integration,
    files,
    reporterOutfile,
    timeoutMs,
    parallel,
    shard,
  } = parseCli();
  if (ci || coverage) {
    const artifactsDir = artifactPath(REPO_ROOT);
    if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });
  }
  if (ci) {
    const reportPath = reporterOutfile ?? ".kimi-artifacts/reports/junit.xml";
    const reportDir = dirname(isAbsolute(reportPath) ? reportPath : join(REPO_ROOT, reportPath));
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  }
  const testHome = artifactPath(REPO_ROOT, "test-home");
  if (!existsSync(testHome)) mkdirSync(testHome, { recursive: true });
  process.env.KIMI_TEST_HOME = testHome;

  const rawBatches = bunTestArgBatches({
    fast,
    coverage,
    ci,
    smoke,
    integration,
    files,
    reporterOutfile,
    bail: ci ? 10 : true,
    timeoutMs,
    parallel,
    shard,
  });
  const forwarded = parseForwardedBunTestArgs(Bun.argv.slice(2));
  const batches = rawBatches.map((batch) => {
    const testIdx = batch.indexOf("test");
    const tail = testIdx >= 0 ? batch.slice(testIdx + 1) : batch.slice(1);
    const merged = mergeBunTestInvocationArgs(["test", ...tail], REPO_ROOT, forwarded);
    return ["bun", ...merged];
  });
  const quiet = Bun.argv.includes("--quiet");

  let finalExitCode = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    if (batches.length > 1 && !quiet) {
      process.stderr.write(`\n[run-tests] batch ${i + 1}/${batches.length}\n`);
    }
    const proc = Bun.spawn(batch[0] === "bun" ? batch : ["bun", ...batch], {
      cwd: REPO_ROOT,
      env: buildTestRunnerEnv({ KIMI_TEST_HOME: process.env.KIMI_TEST_HOME }),
      stdout: quiet ? "pipe" : "inherit",
      stderr: quiet ? "pipe" : "inherit",
    });
    const exitCode = await proc.exited;
    if (quiet) {
      const out = await readableStreamToText(proc.stdout);
      if (out) process.stdout.write(out);
      const err = await readableStreamToText(proc.stderr);
      if (err) process.stderr.write(err);
    }
    if (exitCode !== 0) {
      finalExitCode = exitCode;
      break;
    }
  }
  process.exit(finalExitCode);
}

main().catch((err) => {
  console.error("run-tests failed:", err.message);
  process.exit(1);
});

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
