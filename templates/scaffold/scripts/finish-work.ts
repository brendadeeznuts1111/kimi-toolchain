#!/usr/bin/env bun
/**
 * Finish-work pipeline — run gates then optionally commit/push.
 * Scaffold slim copy for toolchain-profile projects.
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
  Bun.stderr.write(`✗ ${result.name}\n`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (detail) Bun.stderr.write(`${detail}\n`);
}

async function runGitSteps(message: string, push: boolean): Promise<number> {
  const add = await $`git add -u`.cwd(REPO_ROOT).nothrow().quiet();
  if (add.exitCode !== 0) return add.exitCode;

  const commit = await $`git commit -m ${message}`.cwd(REPO_ROOT).nothrow().quiet();
  if (commit.exitCode !== 0) return commit.exitCode;

  if (!push) return 0;
  const pushResult = await $`git push`.cwd(REPO_ROOT).nothrow().quiet();
  return pushResult.exitCode;
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
      return result.exitCode;
    }
  }

  if (!options.skipGit && options.message) {
    const gitCode = await runGitSteps(options.message, options.push);
    if (gitCode !== 0) return gitCode;
  } else if (!options.json) {
    process.stderr.write("✓ finish-work — gates passed\n");
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
