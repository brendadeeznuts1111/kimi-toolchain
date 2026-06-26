#!/usr/bin/env bun
/**
 * Computes the affected CI matrix for GitHub Actions.
 *
 * The policy lives in ci/impact.config.json. Unknown risky source paths fall back
 * to full validation so change-based selection cannot silently skip coverage.
 */

import { $ } from "bun";
import { join } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import {
  analyzeImpact,
  buildModuleGraph,
  type ImpactConfig,
  type ImpactResult,
} from "../src/lib/ci-impact.ts";
import { safeParse } from "../src/lib/utils.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(REPO_ROOT, "ci", "impact.config.json");

interface CliOptions {
  base?: string;
  head?: string;
  changed?: string[];
  json: boolean;
}

function parseCli(): CliOptions {
  const argv = Bun.argv.slice(2);
  const options: CliOptions = { json: argv.includes("--json") };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--base") {
      options.base = argv[++i];
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }
    if (arg === "--head") {
      options.head = argv[++i];
      continue;
    }
    if (arg.startsWith("--head=")) {
      options.head = arg.slice("--head=".length);
      continue;
    }
    if (arg === "--changed") {
      options.changed = splitList(argv[++i] ?? "");
      continue;
    }
    if (arg.startsWith("--changed=")) {
      options.changed = splitList(arg.slice("--changed=".length));
    }
  }
  return options;
}

async function main() {
  const options = parseCli();
  const configText = await Bun.file(CONFIG_PATH).text();
  const config = safeParse<ImpactConfig>(
    configText,
    null as unknown as ImpactConfig,
    isImpactConfig
  );
  if (!config) {
    throw new Error(`Invalid impact config: ${CONFIG_PATH}`);
  }

  const changedFiles = options.changed ?? (await getChangedFiles(options));
  const trackedFiles = await getTrackedFiles();
  const graph = await buildModuleGraph(REPO_ROOT, trackedFiles);
  const result = analyzeImpact(config, changedFiles, graph);
  await writeGithubOutputs(result);

  if (options.json) {
    writeStdoutJsonSync(result, 2);
    return;
  }

  printSummary(result);
}

async function getTrackedFiles(): Promise<string[]> {
  const result = await $`git ls-files`.cwd(REPO_ROOT).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `git ls-files exited ${result.exitCode}`);
  }
  return splitList(result.stdout.toString());
}

async function getChangedFiles(options: CliOptions): Promise<string[]> {
  const head = options.head || Bun.env.GITHUB_SHA || "HEAD";
  const base = options.base || defaultBase();
  const files = await gitDiffFiles(base, head);
  if (files.length > 0 || base === "HEAD~1") return files;
  return await gitDiffFiles("HEAD~1", head);
}

function defaultBase(): string {
  if (Bun.env.GITHUB_BASE_REF) return `origin/${Bun.env.GITHUB_BASE_REF}`;
  const before = Bun.env.GITHUB_EVENT_BEFORE;
  if (before && !/^0+$/.test(before)) return before;
  return "HEAD~1";
}

async function gitDiffFiles(base: string, head: string): Promise<string[]> {
  const result = await $`git diff --name-only --diff-filter=ACMR ${base}...${head}`
    .cwd(REPO_ROOT)
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr) console.error(stderr);
    return [];
  }
  return splitList(result.stdout.toString());
}

async function writeGithubOutputs(result: ImpactResult): Promise<void> {
  const outputPath = Bun.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [
    ["changed_count", String(result.changedFiles.length)],
    ["change_type", result.changeType],
    ["docs_only", String(result.docsOnly)],
    ["full_required", String(result.fullRequired)],
    ["full_reason", result.fullReason ?? ""],
    ["unit_tests", result.unitTests.join(",")],
    ["integration_tests", result.integrationTests.join(",")],
    ["smoke_required", String(result.smokeRequired)],
    ["benchmark_ids", result.benchmarkIds.join(",")],
    ["benchmark_required", String(result.benchmarkIds.length > 0)],
    ["security_required", String(result.securityRequired)],
    ["matrix", JSON.stringify({ include: result.matrix })],
  ].map(([key, value]) => `${key}=${value}`);
  await Bun.write(outputPath, `${lines.join("\n")}\n`);
}

function printSummary(result: ImpactResult): void {
  console.log("CI impact analysis");
  console.log(`  changed files: ${result.changedFiles.length}`);
  console.log(`  change type: ${result.changeType}`);
  console.log(`  docs only: ${result.docsOnly}`);
  console.log(
    `  full required: ${result.fullRequired}${result.fullReason ? ` (${result.fullReason})` : ""}`
  );
  if (result.unmatchedRiskyFiles.length > 0) {
    console.log(`  unmatched risky files: ${result.unmatchedRiskyFiles.join(", ")}`);
  }
  console.log(`  unit tests: ${result.unitTests.length || "none"}`);
  console.log(`  integration tests: ${result.integrationTests.length || "none"}`);
  console.log(`  smoke: ${result.smokeRequired}`);
  console.log(`  benchmarks: ${result.benchmarkIds.join(", ") || "none"}`);
  console.log(`  security: ${result.securityRequired}`);
  console.log(`  matrix: ${result.matrix.map((entry) => entry.gate).join(", ")}`);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isImpactConfig(value: unknown): value is ImpactConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as ImpactConfig;
  return (
    config.version === 1 &&
    Array.isArray(config.docsOnly) &&
    Array.isArray(config.fullRun) &&
    Array.isArray(config.risky) &&
    Array.isArray(config.security) &&
    Array.isArray(config.benchmarks) &&
    Array.isArray(config.targets)
  );
}

main().catch((err) => {
  console.error("ci-impact failed:", err.message);
  process.exit(1);
});
