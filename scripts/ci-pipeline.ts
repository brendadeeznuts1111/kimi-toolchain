#!/usr/bin/env bun
/**
 * Thin Bun wrapper for the Effect CI pipeline.
 */

import { join } from "path";
import { runCiPipeline, type PipelineOptions } from "../src/lib/effect/ci-pipeline.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseCli(): PipelineOptions {
  const argv = Bun.argv.slice(2);
  const options: PipelineOptions = {
    repoRoot: REPO_ROOT,
    affected: argv.includes("--affected"),
    full: argv.includes("--full"),
    json: argv.includes("--json"),
    dryRun: argv.includes("--dry-run"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
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
      continue;
    }
    if (arg === "--concurrency") {
      options.concurrency = parseInt(argv[++i] ?? "", 10);
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      options.concurrency = parseInt(arg.slice("--concurrency=".length), 10);
      continue;
    }
    if (arg === "--fast-min") {
      options.fastMinScore = parseInt(argv[++i] ?? "", 10);
      continue;
    }
    if (arg.startsWith("--fast-min=")) {
      options.fastMinScore = parseInt(arg.slice("--fast-min=".length), 10);
      continue;
    }
    if (arg === "--full-min") {
      options.fullMinScore = parseInt(argv[++i] ?? "", 10);
      continue;
    }
    if (arg.startsWith("--full-min=")) {
      options.fullMinScore = parseInt(arg.slice("--full-min=".length), 10);
    }
  }
  return options;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const exitCode = await runCiPipeline(parseCli());
process.exit(exitCode);
