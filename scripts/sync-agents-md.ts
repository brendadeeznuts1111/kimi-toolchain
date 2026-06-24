#!/usr/bin/env bun
/**
 * Sync marker-delimited AGENTS.md sections from live project sources.
 *
 * Blocks: package.json bins, dx.config.toml endpoints + finishWork gates,
 * src/lib/README.md domains, src/gates registry prose patches.
 *
 * Usage:
 *   bun run agents:sync              # rewrite stale blocks
 *   bun run agents:sync --check      # exit 1 when stale
 */

import { runAgentsMdSyncCli } from "../src/lib/agents-md-sync.ts";

const result = await runAgentsMdSyncCli(Bun.argv.slice(2));
console.log(result.message);
process.exit(result.exitCode);
