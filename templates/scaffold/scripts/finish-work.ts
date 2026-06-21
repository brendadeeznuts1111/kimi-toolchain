#!/usr/bin/env bun
/**
 * Finish-work pipeline — run gates then optionally commit/push.
 * Scaffold slim copy for toolchain-profile projects.
 *
 * Exit codes: 0 = success or dry-run; 1 = gate, git, or unhandled failure.
 */

import { join } from "path";
import { $ } from "bun";
import { readableStreamToText } from "./lib/bun-utils.ts";
import {
  escalateFinishWorkToReviewer,
  finishWorkOutcome,
  shouldEscalateToReviewer,
  type FinishWorkReport,
} from "./finish-work-herdr.ts";
import { loadFinishWorkConfig, type FinishWorkFollowUp } from "./finish-work-config.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface CliOptions {
  dryRun: boolean;
  json: boolean;
  skipGit: boolean;
  push: boolean;
  message: string | null;
}

interface GateResult {
  name: string;
  exitCode: number;
  ms: number;
  stdout: string;
  stderr: string;
}

interface GitResult {
  attempted: boolean;
  committed: boolean;
  pushed: boolean;
  error: string | null;
}

function noColorEnabled(): boolean {
  return Bun.env.NO_COLOR !== undefined && Bun.env.NO_COLOR !== "0" && Bun.env.NO_COLOR !== "false";
}

function failMark(): string {
  return noColorEnabled() ? "FAIL" : "✗";
}

function okMark(): string {
  return noColorEnabled() ? "OK" : "✓";
}

function parseCli(): CliOptions {
  const argv = Bun.argv.slice(2);
  let dryRun = false;
  let json = false;
  let skipGit = false;
  let push = false;
  let message: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--skip-git") {
      skipGit = true;
      continue;
    }
    if (arg === "--push") {
      push = true;
      continue;
    }
    if (arg === "--message" || arg === "-m") {
      const next = argv[++i];
      if (!next) throw new Error("--message requires a value");
      message = next;
      continue;
    }
    if (arg.startsWith("--message=")) {
      message = arg.slice("--message=".length);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (!message) message = arg;
  }

  return { dryRun, json, skipGit, push, message };
}

function gateName(command: string, index: number): string {
  const trimmed = command.trim();
  const first = trimmed.split(/\s+/)[0] ?? `gate-${index + 1}`;
  return first.replace(/^bun$/, trimmed.includes("run") ? "bun-run" : "bun");
}

function followUpStepName(command: string): string {
  const trimmed = command.trim();
  const first = trimmed.split(/\s+/)[0] ?? "follow-up";
  if (first.includes("doctor")) return "effect-floor";
  return first.replace(/^kimi-/, "");
}

async function runFollowUpStep(
  followUp: FinishWorkFollowUp,
  options: { pushed: boolean; skipGit: boolean; treeClean: boolean }
) {
  if (options.skipGit) {
    return { command: followUp.command, ran: false, skipped: true, reason: "skip-git" };
  }
  if (!options.pushed) {
    return { command: followUp.command, ran: false, skipped: true, reason: "push required" };
  }
  if (!options.treeClean) {
    return {
      command: followUp.command,
      ran: false,
      skipped: true,
      reason: "dirty tree escalated",
    };
  }
  const result = await runShellGate(followUpStepName(followUp.command), followUp.command);
  if (result.exitCode !== 0) {
    return {
      command: followUp.command,
      ran: true,
      exitCode: result.exitCode,
      ms: result.ms,
      error: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "follow-up failed",
    };
  }
  return { command: followUp.command, ran: true, exitCode: result.exitCode, ms: result.ms };
}

async function runShellGate(name: string, command: string): Promise<GateResult> {
  const start = Bun.nanoseconds();
  const proc = Bun.spawn(["sh", "-lc", command], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return {
    name,
    exitCode,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout,
    stderr,
  };
}

function emitGateFailure(result: GateResult): void {
  Bun.stderr.write(`${failMark()} ${result.name}\n`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (detail) Bun.stderr.write(`${detail}\n`);
}

async function porcelainDirtyLines(): Promise<string[]> {
  const result = await $`git status --porcelain=v1`.cwd(REPO_ROOT).nothrow().quiet();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function runGitSteps(message: string, push: boolean): Promise<GitResult> {
  const result: GitResult = {
    attempted: true,
    committed: false,
    pushed: false,
    error: null,
  };

  const add = await $`git add -u`.cwd(REPO_ROOT).nothrow().quiet();
  if (add.exitCode !== 0) {
    result.error = add.stderr.toString().trim() || "git add failed";
    return result;
  }

  const commit = await $`git commit -m ${message}`.cwd(REPO_ROOT).nothrow().quiet();
  if (commit.exitCode !== 0) {
    result.error = `${commit.stdout}${commit.stderr}`.trim() || "git commit failed";
    return result;
  }
  result.committed = true;

  if (!push) return result;

  const pushResult = await $`git push`.cwd(REPO_ROOT).nothrow().quiet();
  if (pushResult.exitCode !== 0) {
    result.error = pushResult.stderr.toString().trim() || "git push failed";
    return result;
  }
  result.pushed = true;
  return result;
}

function logDryGitSteps(options: CliOptions): void {
  if (options.skipGit) return;
  if (options.message) {
    process.stderr.write("[DRY] Would run: git add -u\n");
    process.stderr.write(`[DRY] Would run: git commit -m ${JSON.stringify(options.message)}\n`);
    if (options.push) process.stderr.write("[DRY] Would run: git push\n");
  } else {
    process.stderr.write("[DRY] Git skipped — no --message\n");
  }
}

async function main(): Promise<number> {
  const options = parseCli();
  const config = loadFinishWorkConfig(REPO_ROOT);

  if (options.dryRun) {
    const payload = {
      schemaVersion: 1,
      tool: "finish-work",
      dryRun: true,
      gateSource: config.source,
      gates: config.gates,
      followUp: config.followUp,
      git: { skipGit: options.skipGit, message: options.message, push: options.push },
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      process.stderr.write("finish-work — dry run\n");
      process.stderr.write(`gate source: ${config.source}\n`);
      for (const gate of config.gates) process.stderr.write(`  → ${gate}\n`);
      if (config.followUp) {
        if (options.push && options.message && !options.skipGit) {
          process.stderr.write(`[DRY] After push: ${config.followUp.command}\n`);
        } else {
          process.stderr.write("follow-up skipped — requires --message and --push\n");
        }
      }
      logDryGitSteps(options);
    }
    return 0;
  }

  const results: GateResult[] = [];
  for (const [index, command] of config.gates.entries()) {
    const result = await runShellGate(gateName(command, index), command);
    results.push(result);
    if (result.exitCode !== 0) {
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({
            schemaVersion: 1,
            tool: "finish-work",
            ok: false,
            failedGate: result.name,
          })}\n`
        );
      } else {
        emitGateFailure(result);
      }
      return 1;
    }
  }

  let git: GitResult = { attempted: false, committed: false, pushed: false, error: null };
  if (!options.skipGit && options.message) {
    git = await runGitSteps(options.message, options.push);
    if (git.error) {
      if (options.json) {
        process.stdout.write(
          `${JSON.stringify({ schemaVersion: 1, tool: "finish-work", ok: false, git })}\n`
        );
      } else {
        process.stderr.write(`${git.error}\n`);
      }
      return 1;
    }
  }

  const dirty = git.pushed ? await porcelainDirtyLines() : [];
  const tree = { clean: dirty.length === 0, dirty };

  const followUpSummary = config.followUp
    ? await runFollowUpStep(config.followUp, {
        pushed: git.pushed,
        skipGit: options.skipGit,
        treeClean: tree.clean,
      })
    : undefined;

  if (followUpSummary?.ran && followUpSummary.exitCode !== 0) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          schemaVersion: 1,
          tool: "finish-work",
          ok: false,
          failedStep: "followUp",
          followUp: followUpSummary,
        })}\n`
      );
    } else {
      process.stderr.write("follow-up failed\n");
      if (followUpSummary.error) process.stderr.write(`${followUpSummary.error}\n`);
    }
    return 1;
  }
  let report: FinishWorkReport = {
    schemaVersion: 1,
    tool: "finish-work",
    ok: true,
    outcome: finishWorkOutcome(true, git.pushed, tree.clean),
    gateSource: config.source,
    results: results.map((item) => ({
      name: item.name,
      exitCode: item.exitCode,
      ms: item.ms,
    })),
    git,
    tree,
    followUp: followUpSummary,
  };

  if (shouldEscalateToReviewer(report)) {
    report = await escalateFinishWorkToReviewer(REPO_ROOT, report);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stderr.write(`${okMark()} finish-work — gates passed\n`);
    if (followUpSummary?.ran && followUpSummary.exitCode === 0) {
      process.stderr.write(`follow-up passed (${followUpSummary.ms ?? 0}ms)\n`);
    }
    if (report.outcome === "escalated") {
      process.stderr.write("warn: post-push tree dirty — escalated to reviewer pane\n");
      if (report.herdr?.reviewerPaneId) {
        process.stderr.write(`  reviewer: ${report.herdr.reviewerPaneId}\n`);
      }
    } else if (git.pushed && dirty.length > 0) {
      process.stderr.write(`warn: working tree dirty after push (${dirty.length} path(s))\n`);
    }
  }

  return report.outcome === "escalated" && !report.herdr?.escalated ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
