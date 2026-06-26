#!/usr/bin/env bun
/**
 * kimi-snapshot — Environment snapshot: save/restore project state
 * Captures git state, untracked files, env vars for rollback
 *
 * Usage:
 *   kimi-snapshot [save|restore|list|show|cleanup|doctor|fix]
 */

import { $ } from "bun";
import { pathExists } from "../lib/bun-io.ts";
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot } from "../lib/utils.ts";
import { snapshotDir } from "../lib/paths.ts";
import {
  snapshotPath,
  saveSnapshot,
  listSnapshots,
  tryReadSnapshot,
} from "../lib/snapshot-core.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-snapshot");
const SNAPSHOT_DIR = snapshotDir();

// ── Restore ──────────────────────────────────────────────────────────

async function restoreSnapshot(id: string, projectDir: string) {
  const path = snapshotPath(id);
  if (!pathExists(path)) {
    throw new Error(`Snapshot not found: ${id}`);
  }

  const snapshot = await tryReadSnapshot(path);
  if (!snapshot) {
    throw new Error(`Snapshot corrupt or invalid: ${id}`);
  }

  logger.section(`Restoring snapshot ${id}`);
  logger.info(`Project: ${snapshot.project}`);
  logger.info(`Branch:  ${snapshot.branch} @ ${snapshot.commit.slice(0, 7)}`);

  const checkoutResult = await $`git checkout ${snapshot.commit}`.cwd(projectDir).nothrow().quiet();
  if (checkoutResult.exitCode !== 0) {
    logger.error(`Git checkout failed: ${checkoutResult.stderr.toString().slice(0, 200)}`);
    return;
  }
  logger.info(`Checked out ${snapshot.commit.slice(0, 7)}`);

  if (snapshot.untrackedFiles.length > 0) {
    logger.info("Untracked files at snapshot time (may need manual restore):");
    for (const f of snapshot.untrackedFiles) {
      logger.line(`    ${f}`);
    }
  }

  if (Object.keys(snapshot.envVars).length > 0) {
    logger.info("Environment variables at snapshot time:");
    for (const [k, v] of Object.entries(snapshot.envVars)) {
      logger.line(`    ${k}=${v.slice(0, 30)}${v.length > 30 ? "..." : ""}`);
    }
  }

  logger.info("Restore complete. Review changes before continuing.");
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  ensureDir(SNAPSHOT_DIR);

  const glob = new Bun.Glob("*.json");
  let total = 0;
  let corrupted = 0;
  let orphaned = 0;
  const projectPaths = new Set<string>();

  for await (const file of glob.scan({ cwd: SNAPSHOT_DIR, absolute: true })) {
    total++;
    try {
      const snap = await tryReadSnapshot(file);
      if (!snap) {
        corrupted++;
        continue;
      }
      if (snap.projectPath && !pathExists(snap.projectPath)) {
        orphaned++;
      }
      if (snap.projectPath) projectPaths.add(snap.projectPath);
    } catch {
      corrupted++;
    }
  }

  checks.push({
    name: "snapshot-dir",
    status: "ok",
    message: `${SNAPSHOT_DIR} accessible`,
    fixable: false,
  });
  checks.push({
    name: "total-snapshots",
    status: "ok",
    message: `${total} snapshot(s)`,
    fixable: false,
  });
  checks.push({
    name: "corrupted",
    status: corrupted === 0 ? "ok" : "warn",
    message: `${corrupted} corrupted`,
    fixable: corrupted > 0,
  });
  checks.push({
    name: "orphaned",
    status: orphaned === 0 ? "ok" : "warn",
    message: `${orphaned} orphaned (project deleted)`,
    fixable: orphaned > 0,
  });

  // Storage usage
  try {
    const result = await $`du -sk ${SNAPSHOT_DIR}`.nothrow().quiet();
    const kb = parseInt(result.stdout.toString().split(/\s+/)[0] ?? "", 10);
    const mb = Math.round(kb / 1024);
    checks.push({
      name: "storage",
      status: mb > 100 ? "warn" : "ok",
      message: `${mb}MB used`,
      fixable: mb > 100,
    });
  } catch {
    checks.push({
      name: "storage",
      status: "warn",
      message: "Could not check storage",
      fixable: false,
    });
  }

  return checks;
}

// ── Fix ──────────────────────────────────────────────────────────────

async function fixSnapshots() {
  logger.section("Fixing Snapshots");
  const glob = new Bun.Glob("*.json");
  let removed = 0;

  for await (const file of glob.scan({ cwd: SNAPSHOT_DIR, absolute: true })) {
    let isCorrupted = false;
    let isOrphaned = false;

    const snap = await tryReadSnapshot(file);
    if (!snap) {
      isCorrupted = true;
    } else if (snap.projectPath && !pathExists(snap.projectPath)) {
      isOrphaned = true;
    }

    if (isCorrupted || isOrphaned) {
      await $`rm ${file}`.nothrow().quiet();
      removed++;
      logger.warn(`Removed ${file.split("/").pop()} (${isCorrupted ? "corrupted" : "orphaned"})`);
    }
  }

  logger.info(`Removed ${removed} snapshot(s)`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "save";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = await getProjectName(projectDir);

  logger.banner("Kimi Snapshot — Environment Capture", project);

  if (command === "save") {
    const description = args.slice(1).join(" ") || undefined;
    logger.section("Saving snapshot");

    if (!pathExists(join(projectDir, ".git"))) {
      logger.error("Not a git repository — snapshots require git");
      return 1;
    }

    const id = await saveSnapshot(projectDir, description);
    logger.info(`Snapshot saved: ${id}`);
    logger.info(`Location: ${snapshotPath(id)}`);
  } else if (command === "restore") {
    const id = args[1];
    if (!id) {
      logger.error("Usage: restore <snapshot-id>");
      return 1;
    }
    await restoreSnapshot(id, projectDir);
  } else if (command === "list") {
    const snaps = await listSnapshots(project);
    logger.section(`Snapshots for ${project}`);
    if (snaps.length === 0) {
      logger.info("No snapshots found");
    } else {
      for (const s of snaps) {
        logger.line(
          `  ${s.id}  ${s.createdAt.slice(0, 19)}  ${s.branch}@${s.commit.slice(0, 7)}  ${s.description.slice(0, 50)}`
        );
      }
    }
  } else if (command === "show") {
    const id = args[1];
    if (!id) {
      logger.error("Usage: show <snapshot-id>");
      return 1;
    }
    const path = snapshotPath(id);
    if (!pathExists(path)) {
      logger.error(`Snapshot not found: ${id}`);
      return 1;
    }
    const snap = await tryReadSnapshot(path);
    if (!snap) {
      logger.error(`Snapshot corrupt or invalid: ${id}`);
      return 1;
    }
    logger.section(`Snapshot ${id}`);
    logger.info(`Project:    ${snap.project}`);
    logger.info(`Path:       ${snap.projectPath}`);
    logger.info(`Created:    ${snap.createdAt}`);
    logger.info(`Branch:     ${snap.branch}`);
    logger.info(`Commit:     ${snap.commit}`);
    logger.info(`Modified:   ${snap.modifiedFiles.length} files`);
    logger.info(`Untracked:  ${snap.untrackedFiles.length} files`);
    logger.info(`Description: ${snap.description}`);
    if (Object.keys(snap.envVars).length > 0) {
      logger.info("Env vars:");
      for (const [k, v] of Object.entries(snap.envVars)) {
        logger.line(`    ${k}=${v.slice(0, 40)}${v.length > 40 ? "..." : ""}`);
      }
    }
  } else if (command === "cleanup") {
    const days = parseInt(args[1] ?? "", 10) || 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const snaps = await listSnapshots();
    let removed = 0;

    for (const s of snaps) {
      const snapTime = new Date(s.createdAt).getTime();
      if (snapTime < cutoff) {
        const path = snapshotPath(s.id);
        await $`rm ${path}`.nothrow().quiet();
        removed++;
      }
    }

    logger.section("Cleanup");
    logger.info(`Removed ${removed} snapshots older than ${days} days`);
  } else if (command === "doctor") {
    const checks = await doctor();
    return logger.runDoctor("kimi-snapshot", checks, "Snapshot Doctor");
  } else if (command === "fix") {
    await fixSnapshots();
  } else {
    logger.section("Commands");
    logger.line("  save [description]   Capture current git state + env vars");
    logger.line("  restore <id>         Checkout snapshot commit");
    logger.line("  list                 Show snapshots for current project");
    logger.line("  show <id>            Display snapshot details");
    logger.line("  cleanup [days]       Remove old snapshots (default 30 days)");
    logger.line("  doctor               Check snapshot integrity");
    logger.line("  fix                  Remove corrupted/orphaned snapshots");
  }

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
    { toolName: "kimi-snapshot", logger }
  );
  process.exit(exitCode);
}
