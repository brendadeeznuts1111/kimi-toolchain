#!/usr/bin/env bun
/**
 * kimi-snapshot — Environment snapshot: save/restore project state
 * Captures git state, untracked files, env vars for rollback
 *
 * Usage:
 *   kimi-snapshot [save|restore|list|show|cleanup|doctor|fix]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot } from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const SNAPSHOT_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "snapshots");

interface Snapshot {
  id: string;
  project: string;
  projectPath: string;
  createdAt: string;
  branch: string;
  commit: string;
  untrackedFiles: string[];
  modifiedFiles: string[];
  envVars: Record<string, string>;
  description: string;
}

function snapshotPath(id: string): string {
  return join(SNAPSHOT_DIR, `${id}.json`);
}

// ── Git State Capture ────────────────────────────────────────────────

async function captureGitState(projectDir: string): Promise<{
  branch: string;
  commit: string;
  untrackedFiles: string[];
  modifiedFiles: string[];
}> {
  const branchResult = await $`git branch --show-current`.cwd(projectDir).nothrow().quiet();
  const branch = branchResult.stdout.toString().trim() || "unknown";

  const commitResult = await $`git rev-parse HEAD`.cwd(projectDir).nothrow().quiet();
  const commit = commitResult.stdout.toString().trim() || "unknown";

  const statusResult = await $`git status --porcelain`.cwd(projectDir).nothrow().quiet();
  const lines = statusResult.stdout.toString().split("\n").filter(Boolean);

  const untrackedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (status.includes("?")) untrackedFiles.push(file);
    else modifiedFiles.push(file);
  }

  return { branch, commit, untrackedFiles, modifiedFiles };
}

// ── Env Var Capture ──────────────────────────────────────────────────

function captureEnvVars(): Record<string, string> {
  const relevant = [
    "PORT",
    "DATABASE_URL",
    "LOG_LEVEL",
    "NODE_ENV",
    "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
    "API_KEY",
    "API_URL",
    "WEBHOOK_URL",
    "REDIS_URL",
    "SMTP_HOST",
  ];
  const captured: Record<string, string> = {};
  for (const key of relevant) {
    const value = Bun.env[key];
    if (value) captured[key] = value;
  }
  return captured;
}

// ── Save ─────────────────────────────────────────────────────────────

async function saveSnapshot(projectDir: string, description?: string): Promise<string> {
  ensureDir(SNAPSHOT_DIR);

  const id = `snap-${Date.now()}`;
  const project = getProjectName(projectDir);
  const gitState = await captureGitState(projectDir);

  const snapshot: Snapshot = {
    id,
    project,
    projectPath: projectDir,
    createdAt: new Date().toISOString(),
    branch: gitState.branch,
    commit: gitState.commit,
    untrackedFiles: gitState.untrackedFiles,
    modifiedFiles: gitState.modifiedFiles,
    envVars: captureEnvVars(),
    description: description || `Snapshot of ${project} at ${gitState.commit.slice(0, 7)}`,
  };

  await Bun.write(snapshotPath(id), JSON.stringify(snapshot, null, 2));
  return id;
}

// ── Restore ──────────────────────────────────────────────────────────

async function restoreSnapshot(id: string, projectDir: string) {
  const path = snapshotPath(id);
  if (!existsSync(path)) {
    throw new Error(`Snapshot not found: ${id}`);
  }

  const snapshot: Snapshot = await Bun.file(path).json();

  console.log(`── Restoring snapshot ${id} ─────────────────────────────────`);
  console.log(`  Project: ${snapshot.project}`);
  console.log(`  Branch:  ${snapshot.branch} @ ${snapshot.commit.slice(0, 7)}`);
  console.log("");

  const checkoutResult = await $`git checkout ${snapshot.commit}`.cwd(projectDir).nothrow().quiet();
  if (checkoutResult.exitCode !== 0) {
    console.error(`  ✗ Git checkout failed: ${checkoutResult.stderr.toString().slice(0, 200)}`);
    return;
  }
  console.log(`  ✓ Checked out ${snapshot.commit.slice(0, 7)}`);

  if (snapshot.untrackedFiles.length > 0) {
    console.log("");
    console.log("  Untracked files at snapshot time (may need manual restore):");
    for (const f of snapshot.untrackedFiles) {
      console.log(`    ${f}`);
    }
  }

  if (Object.keys(snapshot.envVars).length > 0) {
    console.log("");
    console.log("  Environment variables at snapshot time:");
    for (const [k, v] of Object.entries(snapshot.envVars)) {
      console.log(`    ${k}=${v.slice(0, 30)}${v.length > 30 ? "..." : ""}`);
    }
  }

  console.log("");
  console.log("  ✓ Restore complete. Review changes before continuing.");
}

// ── List ─────────────────────────────────────────────────────────────

async function listSnapshots(project?: string): Promise<Snapshot[]> {
  ensureDir(SNAPSHOT_DIR);
  const snapshots: Snapshot[] = [];

  const glob = new Bun.Glob("*.json");
  for await (const file of glob.scan({ cwd: SNAPSHOT_DIR, absolute: true })) {
    try {
      const snap: Snapshot = await Bun.file(file).json();
      if (!project || snap.project === project) {
        snapshots.push(snap);
      }
    } catch {
      // Skip malformed
    }
  }

  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      const snap: Snapshot = await Bun.file(file).json();
      if (!snap.id || !snap.project || !snap.commit) {
        corrupted++;
      }
      if (snap.projectPath && !existsSync(snap.projectPath)) {
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
    const kb = parseInt(result.stdout.toString().split(/\s+/)[0], 10);
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
  console.log("── Fixing Snapshots ──────────────────────────────────────────");
  const glob = new Bun.Glob("*.json");
  let removed = 0;

  for await (const file of glob.scan({ cwd: SNAPSHOT_DIR, absolute: true })) {
    let isCorrupted = false;
    let isOrphaned = false;

    try {
      const snap: Snapshot = await Bun.file(file).json();
      if (!snap.id || !snap.project || !snap.commit) {
        isCorrupted = true;
      }
      if (snap.projectPath && !existsSync(snap.projectPath)) {
        isOrphaned = true;
      }
    } catch {
      isCorrupted = true;
    }

    if (isCorrupted || isOrphaned) {
      await $`rm ${file}`.nothrow().quiet();
      removed++;
      console.log(
        `  ✗ Removed ${file.split("/").pop()} (${isCorrupted ? "corrupted" : "orphaned"})`
      );
    }
  }

  console.log(`  ✓ Removed ${removed} snapshot(s)`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "save";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = getProjectName(projectDir);

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Snapshot — Environment Capture                ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`  Project: ${project}`);
  console.log("");

  if (command === "save") {
    const description = args.slice(1).join(" ") || undefined;
    console.log(`── Saving snapshot ───────────────────────────────────────────`);

    if (!existsSync(join(projectDir, ".git"))) {
      console.log("  ✗ Not a git repository — snapshots require git");
      process.exit(1);
    }

    const id = await saveSnapshot(projectDir, description);
    console.log(`  ✓ Snapshot saved: ${id}`);
    console.log(`  Location: ${snapshotPath(id)}`);
  } else if (command === "restore") {
    const id = args[1];
    if (!id) {
      console.log("Usage: restore <snapshot-id>");
      process.exit(1);
    }
    await restoreSnapshot(id, projectDir);
  } else if (command === "list") {
    const snaps = await listSnapshots(project);
    console.log(`── Snapshots for ${project} ──────────────────────────────────`);
    if (snaps.length === 0) {
      console.log("  No snapshots found");
    } else {
      for (const s of snaps) {
        console.log(
          `  ${s.id}  ${s.createdAt.slice(0, 19)}  ${s.branch}@${s.commit.slice(0, 7)}  ${s.description.slice(0, 50)}`
        );
      }
    }
  } else if (command === "show") {
    const id = args[1];
    if (!id) {
      console.log("Usage: show <snapshot-id>");
      process.exit(1);
    }
    const path = snapshotPath(id);
    if (!existsSync(path)) {
      console.log(`  ✗ Snapshot not found: ${id}`);
      process.exit(1);
    }
    const snap: Snapshot = await Bun.file(path).json();
    console.log(`── Snapshot ${id} ────────────────────────────────────────────`);
    console.log(`  Project:    ${snap.project}`);
    console.log(`  Path:       ${snap.projectPath}`);
    console.log(`  Created:    ${snap.createdAt}`);
    console.log(`  Branch:     ${snap.branch}`);
    console.log(`  Commit:     ${snap.commit}`);
    console.log(`  Modified:   ${snap.modifiedFiles.length} files`);
    console.log(`  Untracked:  ${snap.untrackedFiles.length} files`);
    console.log(`  Description: ${snap.description}`);
    if (Object.keys(snap.envVars).length > 0) {
      console.log("  Env vars:");
      for (const [k, v] of Object.entries(snap.envVars)) {
        console.log(`    ${k}=${v.slice(0, 40)}${v.length > 40 ? "..." : ""}`);
      }
    }
  } else if (command === "cleanup") {
    const days = parseInt(args[1], 10) || 30;
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

    console.log(`── Cleanup ───────────────────────────────────────────────────`);
    console.log(`  Removed ${removed} snapshots older than ${days} days`);
  } else if (command === "doctor") {
    const checks = await doctor();
    console.log("── Snapshot Doctor ───────────────────────────────────────────");
    let errors = 0,
      warns = 0,
      fixable = 0;
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
    if (fixable > 0) {
      console.log("  Run 'kimi-snapshot fix' to repair");
    }
  } else if (command === "fix") {
    await fixSnapshots();
  } else {
    console.log("Commands:");
    console.log("  save [description]   Capture current git state + env vars");
    console.log("  restore <id>         Checkout snapshot commit");
    console.log("  list                 Show snapshots for current project");
    console.log("  show <id>            Display snapshot details");
    console.log("  cleanup [days]       Remove old snapshots (default 30 days)");
    console.log("  doctor               Check snapshot integrity");
    console.log("  fix                  Remove corrupted/orphaned snapshots");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Snapshot failed:", err.message);
  process.exit(1);
});
