#!/usr/bin/env bun
/**
 * PR merge readiness — local Bun CI is authoritative; GitHub Actions billing failures are ignored.
 *
 * Usage:
 *   bun run pr:status
 *   bun run pr:status --number 11
 *   bun run pr:status --skip-local-ci
 *   bun run pr:status --json
 */

import { $ } from "bun";
import { join } from "path";
import {
  parseGhStatusCheckRollup,
  summarizePrChecks,
  type PrChecksReport,
} from "../src/lib/github-pr-checks.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface GhPrView {
  number: number;
  url: string;
  title: string;
  state: string;
  mergeable: string;
  mergeStateStatus: string;
  statusCheckRollup: Array<{
    __typename?: string;
    name?: string;
    conclusion?: string | null;
    detailsUrl?: string;
    status?: string;
  }>;
}

function parseCli(): { number: number | null; skipLocalCi: boolean; json: boolean } {
  const argv = Bun.argv.slice(2);
  let number: number | null = null;
  let skipLocalCi = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--skip-local-ci") {
      skipLocalCi = true;
      continue;
    }
    if (arg === "--number" || arg === "-n") {
      const next = Number(argv[++i]);
      if (Number.isInteger(next) && next > 0) number = next;
      continue;
    }
    if (arg.startsWith("--number=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isInteger(value) && value > 0) number = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { number, skipLocalCi, json };
}

async function resolvePrNumber(explicit: number | null): Promise<number> {
  if (explicit) return explicit;

  const result = await $`gh pr view --json number --jq .number`.cwd(REPO_ROOT).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error("No PR for current branch — pass --number <n>");
  }
  const number = Number(result.stdout.toString().trim());
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("Could not resolve PR number");
  }
  return number;
}

async function loadPr(number: number): Promise<GhPrView> {
  const result =
    await $`gh pr view ${number} --json number,url,title,state,mergeable,mergeStateStatus,statusCheckRollup`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Could not load PR #${number}`);
  }
  return JSON.parse(result.stdout.toString()) as GhPrView;
}

async function runLocalCi(): Promise<boolean> {
  const proc = Bun.spawn(["bun", "run", "scripts/ci-local.ts", "--json"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    proc.exited,
  ]);
  if (exitCode !== 0) return false;
  try {
    const payload = JSON.parse(stdout) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return exitCode === 0;
  }
}

function printHuman(pr: GhPrView, checks: PrChecksReport, localCiPassing: boolean | null): void {
  console.log(`PR #${pr.number}  ${pr.title}`);
  console.log(pr.url);
  console.log(`  mergeable: ${pr.mergeable} (${pr.mergeStateStatus})`);
  if (localCiPassing === null) {
    console.log("  local-ci:  skipped");
  } else {
    console.log(`  local-ci:  ${localCiPassing ? "pass" : "FAIL — run: bun run ci:local"}`);
  }
  if (checks.ignored.length > 0) {
    console.log(
      `  ignored:   ${checks.ignored.map((check) => check.name).join(", ")} (Actions billing/unavailable)`
    );
  }
  if (checks.blocking.length > 0) {
    console.log(`  blocking:  ${checks.blocking.map((check) => check.name).join(", ")}`);
  }
  console.log(`  verdict:   ${checks.message}`);
}

async function main(): Promise<number> {
  const { number, skipLocalCi, json } = parseCli();
  const prNumber = await resolvePrNumber(number);
  const pr = await loadPr(prNumber);

  const localCiPassing = skipLocalCi ? null : await runLocalCi();
  const rollup = parseGhStatusCheckRollup(pr.statusCheckRollup ?? []);
  const checks = summarizePrChecks(rollup, {
    localCiPassing: skipLocalCi ? null : localCiPassing,
  });

  const mergeReady =
    pr.mergeable === "MERGEABLE" &&
    checks.requiredPassing &&
    (skipLocalCi || localCiPassing === true);

  const payload = {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    mergeReady,
    localCi: localCiPassing === null ? "skipped" : localCiPassing ? "pass" : "fail",
    checks,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHuman(pr, checks, localCiPassing);
  }

  return mergeReady ? 0 : 1;
}

main().catch((err: Error) => {
  console.error("pr:status failed:", err.message);
  process.exit(1);
});
