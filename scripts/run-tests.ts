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
import { artifactPath } from "../src/lib/artifacts.ts";
import { bunTestArgs } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseCli(): {
  fast: boolean;
  coverage: boolean;
  ci: boolean;
  smoke: boolean;
  integration: boolean;
  files: string[];
  reporterOutfile?: string;
} {
  const argv = Bun.argv.slice(2);
  const files: string[] = [];
  let reporterOutfile: string | undefined;
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
  };
}

async function main() {
  const { fast, coverage, ci, smoke, integration, files, reporterOutfile } = parseCli();
  if (ci || coverage) {
    const artifactsDir = artifactPath(REPO_ROOT);
    if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });
  }
  if (ci) {
    const reportPath = reporterOutfile ?? ".kimi-artifacts/reports/junit.xml";
    const reportDir = dirname(isAbsolute(reportPath) ? reportPath : join(REPO_ROOT, reportPath));
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  }
  const cmd = [
    "bun",
    ...bunTestArgs({
      fast,
      coverage,
      ci,
      smoke,
      integration,
      files,
      reporterOutfile,
      bail: ci ? 10 : true,
    }),
  ];
  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
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
