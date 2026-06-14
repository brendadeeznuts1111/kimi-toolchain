/**
 * src/lib/snapshot-core.ts
 *
 * Library functions for environment snapshot save/restore.
 * No CLI side effects — pure data capture and I/O.
 */

import { $ } from "bun";
import { join } from "path";
import { ensureDir, getProjectName } from "./utils.ts";
import { snapshotDir } from "./paths.ts";

const SNAPSHOT_DIR = snapshotDir();

export interface Snapshot {
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

export function snapshotPath(id: string): string {
  return join(SNAPSHOT_DIR, `${id}.json`);
}

export async function captureGitState(projectDir: string): Promise<{
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

export function captureEnvVars(): Record<string, string> {
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

export async function saveSnapshot(projectDir: string, description?: string): Promise<string> {
  ensureDir(SNAPSHOT_DIR);

  const id = `snap-${Date.now()}`;
  const project = await getProjectName(projectDir);
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

export async function listSnapshots(project?: string): Promise<Snapshot[]> {
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
