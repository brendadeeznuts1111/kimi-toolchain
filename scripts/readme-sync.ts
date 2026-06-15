#!/usr/bin/env bun
/**
 * CLI wrapper for README ↔ package.json sync (lib stays free of process.exit).
 */

import { runReadmeSyncCli } from "../src/lib/readme-sync.ts";

const result = await runReadmeSyncCli(Bun.argv.slice(2));
console.log(result.message);
process.exit(result.exitCode);
