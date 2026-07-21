#!/usr/bin/env bun
/**
 * kimi-orphan-kill — Emergency orphan process cleanup
 * Kills parentless bun test / kimi-tool processes without touching system services.
 *
 * Orphan definition: a candidate command (bun test / gate entry point / install
 * or typecheck storm) whose PARENT IS DEAD. Processes with a live parent are
 * never killed — a long suite is owned by its live gate, and the gate's
 * wall-clock watchdog handles stuck children. Also sweeps stale
 * `.kimi-test-locks/` entries (dead owners).
 *
 * Usage:
 *   kimi-orphan-kill [--dry-run]
 */

import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { createLogger } from "../lib/logger.ts";
import { CliError } from "../lib/effect/errors.ts";
import { getOrphanCandidates } from "../lib/proc-cache.ts";
import { runOrphanKill, clearStaleLocks } from "../lib/process-utils.ts";

const logger = createLogger(Bun.argv, "kimi-orphan-kill");

async function main(): Promise<number> {
  const DRY_RUN = Bun.argv.includes("--dry-run");
  const orphans = getOrphanCandidates();

  if (orphans.length === 0) {
    logger.info("No orphan processes found");
    await clearStaleLocks();
    return 0;
  }

  logger.info(`Found ${orphans.length} orphan process(es):`);
  for (const o of orphans) {
    logger.info(`PID ${o.pid}  CPU ${o.cpu}%  ${o.cmd.slice(0, 80)}`);
  }

  if (DRY_RUN) {
    logger.info("(Dry run — no processes killed)");
    return 0;
  }

  logger.info("Killing orphans...");
  const { killed } = await runOrphanKill(false);
  logger.info(`Killed ${killed} orphan process(es)`);
  return 0;
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-orphan-kill", logger }
  );
  process.exit(exitCode);
}
