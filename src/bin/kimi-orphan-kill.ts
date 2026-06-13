#!/usr/bin/env bun
/**
 * kimi-orphan-kill — Emergency orphan process cleanup
 * Kills runaway bun test / kimi-tool processes without touching system services.
 *
 * Usage:
 *   kimi-orphan-kill [--dry-run]
 */

import { getOrphanProcesses, runOrphanKill, clearStaleLocks } from "../lib/process-utils.ts";

// ── CLI ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const DRY_RUN = Bun.argv.includes("--dry-run");
  const orphans = getOrphanProcesses();

  if (orphans.length === 0) {
    console.log("✓ No orphan processes found");
    await clearStaleLocks();
    process.exit(0);
  }

  console.log(`Found ${orphans.length} orphan process(es):`);
  for (const o of orphans) {
    console.log(`  PID ${o.pid}  CPU ${o.cpu}%  ${o.cmd.slice(0, 80)}`);
  }

  if (DRY_RUN) {
    console.log("\n(Dry run — no processes killed)");
    process.exit(0);
  }

  console.log("\nKilling orphans...");
  const { killed } = await runOrphanKill(false);
  console.log(`✓ Killed ${killed} orphan process(es)`);
  process.exit(0);
}
