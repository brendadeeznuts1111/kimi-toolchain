#!/usr/bin/env bun
/**
 * kimi-workflow — Continuous scanner workflow with drift detection and effect handlers.
 *
 * Usage:
 *   kimi-workflow start --domain com.example.app --seed seeds/com.example.app.json5
 *   kimi-workflow start --domain com.example.app --seed seeds/base.json5 --alert-url https://hooks.slack.com/...
 *   kimi-workflow start --domain com.example.app --fix --report reports/latest.md
 */

import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { pathExists } from "../lib/bun-io.ts";
import { createLogger } from "../lib/logger.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { defaultSeedPath } from "../lib/workflow/seed.ts";
import { WorkflowLoop } from "../lib/workflow/loop.ts";
import { workflowRunAllEffect } from "../lib/workflow/run-all-effect.ts";
import type { IssueSeverity, WorkflowEffects, WorkflowOptions } from "../lib/workflow/types.ts";

const logger = createLogger(Bun.argv, "kimi-workflow");

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseSeverity(value: string | undefined): IssueSeverity | undefined {
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  throw new Error(`invalid severity: ${value}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-workflow start [options]");
  logger.line("");
  logger.line("Options:");
  logger.line("  --domain <id>            Workflow domain id (required)");
  logger.line("  --scanners <csv>         Scanner ids (default: all built-ins)");
  logger.line("  --interval <ms>          Watch interval (default: 60000)");
  logger.line("  --output <table|json|herdr>");
  logger.line("  --seed <path>            Baseline seed for drift detection");
  logger.line("  --seed-write <path>      Write current results as seed");
  logger.line("  --watch                  Repeat scans on interval");
  logger.line("  --dry-run                Skip output, effects, and seed writes");
  logger.line("  --fail-on-issue          Exit 1 when any issue is found");
  logger.line("  --fail-on-drift         Exit 1 when drift vs seed is detected");
  logger.line("  --fail-on-severity <lvl> Exit 1 at severity threshold");
  logger.line("");
  logger.line("Effects:");
  logger.line("  --log                    Extra drift logging (default on)");
  logger.line("  --no-log                 Disable extra drift logging");
  logger.line("  --alert-url <url>        POST webhook alert on completion");
  logger.line("  --alert <url>            Alias for --alert-url");
  logger.line("  --fix                    Attempt semver auto-remediation");
  logger.line(
    "  --report [path]          Write Markdown report (default: reports/<domain>-workflow.md)"
  );
}

function buildEffects(args: string[]): WorkflowEffects {
  const reportArgIndex = args.indexOf("--report");
  let report: WorkflowEffects["report"];
  if (reportArgIndex >= 0) {
    const next = args[reportArgIndex + 1];
    report = next && !next.startsWith("--") ? next : true;
  }

  return {
    log: !hasFlag(args, "--no-log"),
    alert: argValue(args, "--alert-url") ?? argValue(args, "--alert"),
    fix: hasFlag(args, "--fix"),
    report,
  };
}

function buildOptions(args: string[], projectRoot: string, domainId: string): WorkflowOptions {
  const seedPath = argValue(args, "--seed") ?? defaultSeedPath(projectRoot, domainId);
  const seedWritePath = argValue(args, "--seed-write");
  const scannersCsv = argValue(args, "--scanners");
  const intervalRaw = argValue(args, "--interval");

  const outputRaw = argValue(args, "--output");
  const output =
    outputRaw === "json" || outputRaw === "herdr" || outputRaw === "table" ? outputRaw : "table";

  return {
    scanners: scannersCsv
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    intervalMs: intervalRaw ? Number.parseInt(intervalRaw, 10) : 60_000,
    output,
    seedPath: hasFlag(args, "--seed") || pathExists(seedPath) ? seedPath : undefined,
    seedWritePath,
    failOnIssue: hasFlag(args, "--fail-on-issue"),
    failOnDrift: hasFlag(args, "--fail-on-drift"),
    failOnSeverity: parseSeverity(argValue(args, "--fail-on-severity")),
    dryRun: hasFlag(args, "--dry-run"),
    watch: hasFlag(args, "--watch"),
    effects: buildEffects(args),
  };
}

async function workflowStart(args: string[]): Promise<number> {
  const domainId = argValue(args, "--domain");
  if (!domainId) {
    printHelp();
    return 1;
  }

  const projectRoot = await resolveProjectRoot(Bun.cwd);
  const loop = new WorkflowLoop(
    { id: domainId, projectRoot },
    buildOptions(args, projectRoot, domainId)
  );

  if (!loop.options.watch) return loop.runAll();
  return Effect.runPromise(workflowRunAllEffect(loop));
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "start") {
    return workflowStart(args.slice(1));
  }

  if (command === "doctor") {
    logger.check({
      name: "workflow",
      status: "ok",
      message: "kimi-workflow CLI available",
      fixable: false,
    });
    return 0;
  }

  logger.error(`unknown command: ${command}`);
  printHelp();
  return 1;
}

if (isDirectRun(import.meta.path)) {
  const code = await main();
  process.exit(code);
}

export { workflowStart, buildOptions, buildEffects };
