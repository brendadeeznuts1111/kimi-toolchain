#!/usr/bin/env bun
/**
 * kimi-cleanup-legacy — Delegates to workspace-commands for legacy path migration.
 *
 * All logic lives in workspace-commands.ts cleanup / workspace-health.ts.
 * This wrapper exists for backward compatibility with scripts that invoke
 * kimi-cleanup-legacy directly.
 *
 * Usage:
 *   kimi-cleanup-legacy [doctor|fix|status]
 *   → same as: kimi-toolchain workspace cleanup [--doctor|--fix|--status]
 */

import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { createLogger } from "../lib/logger.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-cleanup-legacy");

async function main(): Promise<number> {
  const { runWorkspaceCommand } = await import("../lib/workspace-commands.ts");

  const cmd = Bun.argv[2] || "status";

  if (cmd === "doctor") {
    logger.info("kimi-cleanup-legacy");
    logger.info("legacy-clone legacy-cursor legacy-sessions");
    // Run cleanup audit (same checks)
    return runWorkspaceCommand("cleanup", ["--list-cursor-slugs"]);
  }
  if (cmd === "fix") {
    logger.info("kimi-cleanup-legacy");
    return runWorkspaceCommand("fix", ["--deep"]);
  }
  if (cmd === "status") {
    logger.info("kimi-cleanup-legacy");
    logger.section("Legacy Path Status");
    logger.info("Sessions: see cleanup audit");
    logger.info("Index lines: see workspace verify");
    logger.info("Cursor slugs: see cleanup audit");
    // cleanup with list flag reports the same status info
    await runWorkspaceCommand("cleanup", ["--list-cursor-slugs"]);
    return 0;
  }

  logger.info("Usage: kimi-cleanup-legacy [doctor|fix|status]");
  logger.info("Prefer: kimi-toolchain workspace cleanup");
  return 1;
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
    { toolName: "kimi-cleanup-legacy", logger }
  );
  process.exit(exitCode);
}
