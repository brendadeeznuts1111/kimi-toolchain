#!/usr/bin/env bun
/**
 * kimi-cleanup-legacy — One-shot legacy path migration tool
 *
 * Handles kimicode-cli → kimi-toolchain rename cleanup:
 *   - Archive legacy wd_kimicode-cli_* session folders
 *   - Prune legacy cwd entries from session_index.jsonl
 *   - Remove legacy Cursor workspace slugs
 *   - Remove legacy symlink at ~/kimicode-cli
 *   - Report what was found vs cleaned
 *
 * Usage:
 *   kimi-cleanup-legacy [doctor|fix|status]
 */

import { Effect } from "effect";
import { aggregateChecks } from "../lib/health-check.ts";
import { getLegacyStatus, runLegacyCleanup, CANONICAL_REPO_NAME } from "../lib/legacy-cleanup.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { createLogger } from "../lib/logger.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-cleanup-legacy");

// ── Doctor ───────────────────────────────────────────────────────────

function doctor() {
  const status = getLegacyStatus();
  const checks: {
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }[] = [];

  checks.push(
    status.legacySessions.length === 0
      ? {
          name: "legacy-sessions",
          status: "ok",
          message: "no legacy wd_* session folders",
          fixable: false,
        }
      : {
          name: "legacy-sessions",
          status: "warn",
          message: `${status.legacySessions.length} legacy session folder(s): ${status.legacySessions.join(", ")}`,
          fixable: true,
        }
  );

  checks.push(
    status.legacyIndexLines === 0
      ? {
          name: "legacy-index",
          status: "ok",
          message: "no legacy cwd entries in session_index",
          fixable: false,
        }
      : {
          name: "legacy-index",
          status: "warn",
          message: `${status.legacyIndexLines} legacy session_index line(s)`,
          fixable: true,
        }
  );

  checks.push(
    status.legacyCursorSlugs.length === 0
      ? {
          name: "legacy-cursor",
          status: "ok",
          message: "no legacy Cursor workspace slugs",
          fixable: false,
        }
      : {
          name: "legacy-cursor",
          status: status.activeCursorSlugs.length > 0 ? "error" : "warn",
          message: `${status.legacyCursorSlugs.length} legacy slug(s)${status.activeCursorSlugs.length > 0 ? `, ${status.activeCursorSlugs.length} active` : ""}`,
          fixable: true,
        }
  );

  checks.push(
    !status.legacySymlinkExists
      ? {
          name: "legacy-symlink",
          status: "ok",
          message: "no legacy symlink at ~/kimicode-cli",
          fixable: false,
        }
      : {
          name: "legacy-symlink",
          status: "warn",
          message: "legacy symlink exists at ~/kimicode-cli",
          fixable: true,
        }
  );

  checks.push(
    !status.legacyCloneExists
      ? {
          name: "legacy-clone",
          status: "ok",
          message: "no legacy clone at ~/kimicode-cli",
          fixable: false,
        }
      : {
          name: "legacy-clone",
          status: "error",
          message: "legacy clone exists at ~/kimicode-cli — rename or remove before continuing",
          fixable: false,
        }
  );

  const report = aggregateChecks("kimi-cleanup-legacy", checks);
  logger.printHealthReport(report);
}

// ── Fix ──────────────────────────────────────────────────────────────

function fix(): number {
  logger.section("Cleaning Legacy Paths");
  const before = getLegacyStatus();

  if (before.legacyCloneExists) {
    logger.error("Legacy clone exists at ~/kimicode-cli — remove or rename it first.");
    logger.info("  mv ~/kimicode-cli ~/kimicode-cli-old  # or delete if unneeded");
    return 1;
  }

  const result = runLegacyCleanup();
  const after = getLegacyStatus();

  logger.info(`Sessions archived: ${result.sessionsArchived.length}`);
  logger.info(`Index lines pruned: ${result.indexLinesPruned}`);
  logger.info(`Cursor slugs removed: ${result.cursorSlugsRemoved.length}`);
  logger.info(`Symlink removed: ${result.legacySymlinkRemoved}`);

  if (after.legacySessions.length === 0 && after.legacyIndexLines === 0) {
    logger.info("Legacy cleanup complete.");
  } else {
    logger.warn("Some legacy items remain — re-run fix or check permissions.");
  }
  return 0;
}

// ── Status ─────────────────────────────────────────────────────────

function status() {
  logger.section("Legacy Path Status");
  const s = getLegacyStatus();
  logger.info(`Sessions: ${s.legacySessions.length}`);
  logger.info(`Index lines: ${s.legacyIndexLines}`);
  logger.info(`Cursor slugs: ${s.legacyCursorSlugs.length} (${s.activeCursorSlugs.length} active)`);
  logger.info(`Symlink: ${s.legacySymlinkExists ? "exists" : "none"}`);
  logger.info(`Clone: ${s.legacyCloneExists ? "exists" : "none"}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const cmd = Bun.argv[2] || "status";

  logger.banner("kimi-cleanup-legacy", `v2.0 — ${CANONICAL_REPO_NAME} migration`);

  if (cmd === "doctor") {
    doctor();
    return 0;
  }
  if (cmd === "fix") {
    return fix();
  }
  if (cmd === "status") {
    status();
    return 0;
  }

  logger.info("Usage: kimi-cleanup-legacy [doctor|fix|status]");
  return 1;
}

if (import.meta.main) {
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
