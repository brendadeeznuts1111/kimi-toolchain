#!/usr/bin/env bun
/**
 * lint-cli-contract.ts — Warn when src/bin tools re-implement common flags
 * that should be parsed through src/lib/cli-contract.ts.
 */

import { join } from "path";
import { listDir, readTextAsync } from "../src/lib/bun-io.ts";

const BIN_DIR = join(import.meta.dir, "..", "src", "bin");

const COMMON_FLAGS = [
  'Bun.argv.includes("--json")',
  'Bun.argv.includes("--quiet")',
  'Bun.argv.includes("--debug")',
  'Bun.argv.includes("--timeout")',
  'Bun.argv.includes("--bail")',
  'Bun.argv.includes("--step-budget")',
  'process.argv.includes("--json")',
  'process.argv.includes("--quiet")',
  'process.argv.includes("--debug")',
  'process.argv.includes("--timeout")',
  'process.argv.includes("--bail")',
  'process.argv.includes("--step-budget")',
];

async function main(): Promise<number> {
  const files = listDir(BIN_DIR).filter((name) => name.endsWith(".ts"));
  let violations = 0;

  for (const file of files) {
    const path = join(BIN_DIR, file);
    const source = await readTextAsync(path);

    for (const pattern of COMMON_FLAGS) {
      if (source.includes(pattern)) {
        console.error(`${file}: re-implements common flag parsing: ${pattern}`);
        console.error(`  Use parseCliFlags()/createCli() from src/lib/cli-contract.ts instead.`);
        violations++;
      }
    }
  }

  if (violations === 0) {
    console.log("lint:cli-contract OK");
    return 0;
  }

  console.error(`\n${violations} cli-contract violation(s) found`);
  return 1;
}

process.exit(await main());
