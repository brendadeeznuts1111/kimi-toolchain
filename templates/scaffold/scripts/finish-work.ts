#!/usr/bin/env bun
/**
 * Finish-work pipeline — run gates then optionally commit/push.
 * Scaffold slim copy for toolchain-profile projects.
 *
 * Exit codes: 0 = success or dry-run; 1 = gate, git, or unhandled failure.
 */

import { join } from "path";
import { $ } from "bun";
import { loadFinishWorkConfig } from "./finish-work-config.ts";

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
  committed: boolean;
  pushed: boolean;
  exitCode: number;
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

async function runShellGate(name: string, command: string): Promise<GateResult> {
  const start = Bun.nanoseconds();
  const proc = Bun.spawn(["sh", "-lc", command], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
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
  const add = await $`git add -u`.cwd(REPO_ROOT).nothrow().quiet();
  if (add.exitCode !== 0) return { committed: false, pushed: false, exitCode: add.exitCode };

  const commit = await $`git commit -m ${message}`.cwd(REPO_ROOT).nothrow().quiet();
  if (commit.exitCode !== 0) return { committed: false, pushed: false, exitCode: commit.exitCode };

  if (!push) return { committed: true, pushed: false, exitCode: 0 };

  const pushResult = await $`git push`.cwd(REPO_ROOT).nothrow().quiet();
  return {
    committed: true,
    pushed: pushResult.exitCode === 0,
    exitCode: pushResult.exitCode,
  };
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
      git: { skipGit: options.skipGit, message: options.message, push: options.push },
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      process.stderr.write("finish-work — dry run\n");
      process.stderr.write(`gate source: ${config.source}\n`);
      for (const gate of config.gates) process.stderr.write(`  → ${gate}\n`);
      logDryGitSteps(options);
    }
    return 0;
  }

  for (const [index, command] of config.gates.entries()) {
    const result = await runShellGate(gateName(command, index), command);
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

  if (!options.skipGit && options.message) {
    const git = await runGitSteps(options.message, options.push);
    if (git.exitCode !== 0) return 1;

    if (git.pushed) {
      const dirty = await porcelainDirtyLines();
      if (dirty.length > 0) {
        process.stderr.write(`warn: working tree dirty after push (${dirty.length} path(s))\n`);
        for (const line of dirty.slice(0, 8)) process.stderr.write(`  ${line}\n`);
        if (dirty.length > 8) process.stderr.write(`  … +${dirty.length - 8} more\n`);
      }
    }
  } else if (!options.json) {
    process.stderr.write(`${okMark()} finish-work — gates passed\n`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
