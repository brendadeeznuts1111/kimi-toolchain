#!/usr/bin/env bun
/**
 * Unified discovery for constants + dx.config.toml inventory.
 *
 * Usage:
 *   bun run discover
 *   bun run discover --help
 */

import { join } from "path";
import { DiscoverCliError, runDiscoverCliEntry } from "../src/lib/discover-cli.ts";

const ROOT = join(import.meta.dir, "..");

if (import.meta.main) {
  try {
    await runDiscoverCliEntry(Bun.argv.slice(2), ROOT);
  } catch (err) {
    if (err instanceof DiscoverCliError) {
      console.error(`discover: ${err.message}`);
      process.exit(err.exitCode);
    }
    console.error("discover failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
