#!/usr/bin/env bun
/**
 * Configuration layers audit — one-shot gate aggregator.
 *
 * Usage:
 *   bun run config:status
 *   bun run config:status --json
 *   bun run config:status --with-scaffold
 *   bun run config:status --help
 */

import { isAbsolute, join, resolve } from "path";
import { writeStdout, writeStdoutLine } from "../src/lib/cli-contract.ts";
import {
  auditConfigLayersStatus,
  CONFIG_STATUS_USAGE,
  printConfigStatusReport,
} from "../src/lib/config-status.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface CliOptions {
  help: boolean;
  json: boolean;
  withScaffold: boolean;
  projectRoot: string;
}

function resolveProjectArg(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function parseCli(): CliOptions {
  const argv = Bun.argv.slice(2);
  let help = false;
  let json = false;
  let withScaffold = false;
  let projectRoot = REPO_ROOT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--with-scaffold") {
      withScaffold = true;
      continue;
    }
    if (arg === "--project") {
      const next = argv[++i];
      if (!next) throw new Error("--project requires a path");
      projectRoot = resolveProjectArg(next);
      continue;
    }
    if (arg.startsWith("--project=")) {
      projectRoot = resolveProjectArg(arg.slice("--project=".length));
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { help, json, withScaffold, projectRoot };
}

async function main(): Promise<void> {
  const options = parseCli();
  if (options.help) {
    await writeStdout(CONFIG_STATUS_USAGE);
    return;
  }

  const report = await auditConfigLayersStatus(options.projectRoot, {
    withScaffold: options.withScaffold,
  });

  if (options.json) {
    await writeStdoutLine(JSON.stringify(report, null, 2));
  } else {
    await printConfigStatusReport(report);
  }

  if (!report.aligned) process.exit(1);
}

main().catch((err: Error) => {
  console.error("config:status failed:", err.message);
  process.exit(1);
});
