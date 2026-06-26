#!/usr/bin/env bun
/**
 * Enhanced PR diff — structured stat summary for agents and humans.
 *
 * Usage:
 *   bun run pr:diff
 *   bun run pr:diff --base main
 *   bun run pr:diff --stat
 *   bun run pr:diff --files
 *   bun run pr:diff --full
 *   bun run pr:diff --json
 */

import { $ } from "bun";
import { join } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";

const REPO_ROOT = join(import.meta.dir, "..");

type Mode = "stat" | "files" | "full";

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  group: string;
}

interface PrDiffReport {
  base: string;
  head: string;
  commitCount: number;
  files: number;
  additions: number;
  deletions: number;
  groups: Record<string, { files: number; additions: number; deletions: number }>;
  changes: FileChange[];
}

function parseCli(): { base: string | null; mode: Mode; json: boolean } {
  const argv = Bun.argv.slice(2);
  let base: string | null = null;
  let mode: Mode = "stat";
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--stat") {
      mode = "stat";
      continue;
    }
    if (arg === "--files") {
      mode = "files";
      continue;
    }
    if (arg === "--full") {
      mode = "full";
      continue;
    }
    if (arg === "--base") {
      base = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--base=")) {
      base = arg.split("=")[1] ?? null;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { base, mode, json };
}

async function resolveBase(explicit: string | null): Promise<string> {
  if (explicit) return explicit.replace(/^origin\//, "");

  const ghDefault = await $`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`
    .cwd(REPO_ROOT)
    .nothrow()
    .quiet();
  if (ghDefault.exitCode === 0) {
    const branch = ghDefault.stdout.toString().trim();
    if (branch) return branch;
  }

  return "main";
}

async function gitRef(base: string): Promise<string> {
  const origin = await $`git rev-parse --verify origin/${base}`.cwd(REPO_ROOT).nothrow().quiet();
  if (origin.exitCode === 0) return `origin/${base}`;
  return base;
}

function topLevelGroup(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

async function buildReport(baseRef: string): Promise<PrDiffReport> {
  const headResult = await $`git rev-parse --short HEAD`.cwd(REPO_ROOT).quiet();
  const head = headResult.stdout.toString().trim();

  const countResult = await $`git rev-list --count ${baseRef}..HEAD`
    .cwd(REPO_ROOT)
    .nothrow()
    .quiet();
  const commitCount = Number(countResult.stdout.toString().trim()) || 0;

  const numstat = await $`git diff --numstat ${baseRef}...HEAD`.cwd(REPO_ROOT).nothrow().quiet();

  const changes: FileChange[] = [];
  let additions = 0;
  let deletions = 0;

  for (const line of numstat.stdout.toString().split("\n")) {
    if (!line.trim()) continue;
    const [addRaw, delRaw, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path || path === "/dev/null") continue;
    const fileAdds = addRaw === "-" ? 0 : Number(addRaw);
    const fileDels = delRaw === "-" ? 0 : Number(delRaw);
    additions += fileAdds;
    deletions += fileDels;
    changes.push({
      path,
      additions: fileAdds,
      deletions: fileDels,
      group: topLevelGroup(path),
    });
  }

  changes.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));

  const groups: PrDiffReport["groups"] = {};
  for (const change of changes) {
    const bucket = groups[change.group] ?? { files: 0, additions: 0, deletions: 0 };
    bucket.files += 1;
    bucket.additions += change.additions;
    bucket.deletions += change.deletions;
    groups[change.group] = bucket;
  }

  return {
    base: baseRef,
    head,
    commitCount,
    files: changes.length,
    additions,
    deletions,
    groups,
    changes,
  };
}

function printStat(report: PrDiffReport): void {
  console.log(`PR diff  ${report.base}...${report.head}  (${report.commitCount} commits)`);
  console.log(`  ${report.files} files  +${report.additions}  -${report.deletions}`);
  console.log("");
  console.log("By area:");
  for (const [group, stats] of Object.entries(report.groups).sort(
    (a, b) => b[1].additions + b[1].deletions - (a[1].additions + a[1].deletions)
  )) {
    console.log(
      `  ${group.padEnd(14)} ${String(stats.files).padStart(3)} files  +${stats.additions}  -${stats.deletions}`
    );
  }
  console.log("");
  console.log("Top changes:");
  for (const change of report.changes.slice(0, 20)) {
    console.log(`  ${change.path}  +${change.additions}  -${change.deletions}`);
  }
  if (report.changes.length > 20) {
    console.log(`  … ${report.changes.length - 20} more files (use --files or --full)`);
  }
}

function printFiles(report: PrDiffReport): void {
  for (const change of report.changes) {
    console.log(`${change.path}\t+${change.additions}\t-${change.deletions}`);
  }
}

async function printFull(baseRef: string): Promise<void> {
  const result = await $`git diff ${baseRef}...HEAD`.cwd(REPO_ROOT).nothrow();
  process.exit(result.exitCode);
}

async function main(): Promise<number> {
  const { base, mode, json } = parseCli();
  const baseBranch = await resolveBase(base);
  const baseRef = await gitRef(baseBranch);

  if (mode === "full") {
    if (!json) await printFull(baseRef);
    return 0;
  }

  const report = await buildReport(baseRef);

  if (json) {
    writeStdoutJsonSync(report, 2);
    return 0;
  }

  if (mode === "files") {
    printFiles(report);
    return 0;
  }

  printStat(report);
  return 0;
}

main().catch((err: Error) => {
  console.error("pr:diff failed:", err.message);
  process.exit(1);
});
