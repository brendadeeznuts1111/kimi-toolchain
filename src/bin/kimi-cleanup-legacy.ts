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

import { homeDir } from "../lib/paths.ts";
import {
  printToolBanner,
  printSection,
  log,
  buildDoctorReport,
  printDoctorReport,
} from "../lib/utils.ts";
import { getLegacyStatus, runLegacyCleanup, CANONICAL_REPO_NAME } from "../lib/legacy-cleanup.ts";

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

  printDoctorReport(buildDoctorReport("kimi-cleanup-legacy", checks));
}

// ── Fix ──────────────────────────────────────────────────────────────

function fix() {
  printSection("Cleaning Legacy Paths");
  const before = getLegacyStatus();

  if (before.legacyCloneExists) {
    log("error", "Legacy clone exists at ~/kimicode-cli — remove or rename it first.");
    log("info", "  mv ~/kimicode-cli ~/kimicode-cli-old  # or delete if unneeded");
    process.exit(1);
  }

  const result = runLegacyCleanup();
  const after = getLegacyStatus();

  log("info", `Sessions archived: ${result.sessionsArchived.length}`);
  log("info", `Index lines pruned: ${result.indexLinesPruned}`);
  log("info", `Cursor slugs removed: ${result.cursorSlugsRemoved.length}`);
  log("info", `Symlink removed: ${result.legacySymlinkRemoved}`);

  if (after.legacySessions.length === 0 && after.legacyIndexLines === 0) {
    log("info", "Legacy cleanup complete.");
  } else {
    log("warn", "Some legacy items remain — re-run fix or check permissions.");
  }
}

// ── Status ─────────────────────────────────────────────────────────

function status() {
  printSection("Legacy Path Status");
  const s = getLegacyStatus();
  log("info", `Sessions: ${s.legacySessions.length}`);
  log("info", `Index lines: ${s.legacyIndexLines}`);
  log("info", `Cursor slugs: ${s.legacyCursorSlugs.length} (${s.activeCursorSlugs.length} active)`);
  log("info", `Symlink: ${s.legacySymlinkExists ? "exists" : "none"}`);
  log("info", `Clone: ${s.legacyCloneExists ? "exists" : "none"}`);
}

// ── Main ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const _home = homeDir();
  const cmd = Bun.argv[2] || "status";

  printToolBanner("kimi-cleanup-legacy", `v2.0 — ${CANONICAL_REPO_NAME} migration`);

  if (cmd === "doctor") {
    doctor();
  } else if (cmd === "fix") {
    fix();
  } else if (cmd === "status") {
    status();
  } else {
    console.log("Usage: kimi-cleanup-legacy [doctor|fix|status]");
    process.exit(1);
  }
}
