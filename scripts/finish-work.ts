#!/usr/bin/env bun
/**
 * Finish-work pipeline — run toolchain gates then optionally commit/push.
 *
 * Usage:
 *   bun run finish-work
 *   bun run finish-work --dry-run
 *   bun run finish-work --json
 *   bun run finish-work --message "feat: add workspace layout"
 *   bun run finish-work --message "fix: gate" --push
 *   bun run finish-work --skip-git
 *
 * Exit codes: 0 = success or dry-run; 1 = gate, git, or unhandled failure.
 */

import { join } from "path";
import { $ } from "bun";
import {
  emitGateFailure,
  okMark,
  porcelainDirtyLines,
  runGate,
  type GateResult,
} from "../src/lib/gate-runner.ts";
import {
  escalateFinishWorkToReviewer,
  finishWorkOutcome,
  shouldEscalateToReviewer as shouldEscalate,
  type FinishWorkReport,
} from "../src/lib/finish-work-herdr.ts";
import { loadFinishWorkConfig } from "../src/lib/finish-work-config.ts";
import { inspectAgent } from "../src/lib/inspect.ts";
import { createLogger } from "../src/lib/logger.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const logger = createLogger(Bun.argv, "finish-work");

interface CliOptions {
  dryRun: boolean;
  json: boolean;
  skipGit: boolean;
  push: boolean;
  message: string | null;
}

interface GitResult {
  attempted: boolean;
  committed: boolean;
  pushed: boolean;
  error: string | null;
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
  return runGate(name, ["sh", "-lc", command], { cwd: REPO_ROOT });
}

async function runGitSteps(message: string, push: boolean, dryRun: boolean): Promise<GitResult> {
  const result: GitResult = {
    attempted: true,
    committed: false,
    pushed: false,
    error: null,
  };

  if (dryRun) return result;

  const add = await $`git add -u`.cwd(REPO_ROOT).nothrow().quiet();
  if (add.exitCode !== 0) {
    result.error = add.stderr.toString().trim() || "git add failed";
    return result;
  }

  const commit = await $`git commit -m ${message}`.cwd(REPO_ROOT).nothrow().quiet();
  if (commit.exitCode !== 0) {
    const detail = `${commit.stdout}${commit.stderr}`.trim();
    result.error = detail || "git commit failed";
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
      git: {
        skipGit: options.skipGit,
        message: options.message,
        push: options.push,
      },
    };
    if (options.json) {
      process.stdout.write(`${inspectAgent(payload)}\n`);
    } else {
      logger.section("finish-work — dry run");
      logger.line(`gate source: ${config.source}`);
      for (const gate of config.gates) logger.line(`  → ${gate}`);
      if (!options.skipGit && options.message) {
        logger.line("[DRY] Would run: git add -u");
        logger.line(`[DRY] Would run: git commit -m ${JSON.stringify(options.message)}`);
        if (options.push) logger.line("[DRY] Would run: git push");
      } else if (!options.skipGit) {
        logger.line("[DRY] Git skipped — no --message");
      }
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
          `${inspectAgent({
            schemaVersion: 1,
            tool: "finish-work",
            ok: false,
            gateSource: config.source,
            failedGate: result.name,
            results: results.map((item) => ({
              name: item.name,
              exitCode: item.exitCode,
              ms: item.ms,
            })),
          })}\n`
        );
      } else {
        emitGateFailure(result);
      }
      return 1;
    }
  }

  let git: GitResult = {
    attempted: false,
    committed: false,
    pushed: false,
    error: null,
  };

  if (!options.skipGit && options.message) {
    git = await runGitSteps(options.message, options.push, false);
    if (git.error) {
      if (options.json) {
        process.stdout.write(
          `${inspectAgent({
            schemaVersion: 1,
            tool: "finish-work",
            ok: false,
            gateSource: config.source,
            results: results.map((item) => ({
              name: item.name,
              exitCode: item.exitCode,
              ms: item.ms,
            })),
            git,
          })}\n`
        );
      } else {
        logger.error(git.error);
      }
      return 1;
    }
  }

  const totalMs = results.reduce((sum, item) => sum + item.ms, 0);
  const dirty = git.pushed ? await porcelainDirtyLines(REPO_ROOT) : [];
  const tree = { clean: dirty.length === 0, dirty };
  const ok = true;

  let report: FinishWorkReport = {
    schemaVersion: 1,
    tool: "finish-work",
    ok,
    outcome: finishWorkOutcome(ok, git.pushed, tree.clean),
    gateSource: config.source,
    results: results.map((item) => ({
      name: item.name,
      exitCode: item.exitCode,
      ms: item.ms,
    })),
    git,
    tree,
  };

  if (shouldEscalate(report)) {
    report = await escalateFinishWorkToReviewer(REPO_ROOT, report);
  }

  if (options.json) {
    process.stdout.write(`${inspectAgent(report)}\n`);
  } else {
    logger.info(`${okMark()} finish-work — ${results.length} gates (${totalMs}ms)`);
    if (git.committed) {
      logger.info(options.push && git.pushed ? "committed and pushed" : "committed");
    } else if (!options.skipGit && !options.message) {
      logger.line("gates passed — add --message to commit");
    }
    if (report.outcome === "escalated") {
      logger.warn("Post-push tree dirty — escalated to reviewer pane");
      if (report.herdr?.reviewerPaneId) {
        logger.line(`  reviewer: ${report.herdr.reviewerPaneId}`);
      }
      if (report.herdr?.error) logger.line(`  herdr: ${report.herdr.error}`);
    } else if (git.pushed && dirty.length > 0) {
      logger.warn(`Working tree dirty after push (${dirty.length} path(s))`);
      for (const line of dirty.slice(0, 8)) logger.line(`  ${line}`);
      if (dirty.length > 8) logger.line(`  … +${dirty.length - 8} more`);
    }
  }

  return report.outcome === "escalated" && !report.herdr?.escalated ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    logger.error(err.message);
    process.exit(1);
  });
