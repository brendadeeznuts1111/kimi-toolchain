#!/usr/bin/env bun
/**
 * Syncs this repo's toolchain source to the desktop install at ~/.kimi-code/.
 */

import {
  finalizeSyncArchive,
  shouldWriteArchive,
  syncDesktop,
  type SyncRunResult,
} from "../src/lib/desktop-sync.ts";
import { provisionUserMcp } from "../src/lib/mcp-config.ts";
import { hasUncommittedChanges } from "../src/lib/version.ts";
import { scriptRepoRoot } from "../src/lib/paths.ts";

const REPO_ROOT = scriptRepoRoot();

type SyncCycleMode = "interactive" | "daemon";

async function syncBunCreateMirror(repoRoot: string, result: SyncRunResult): Promise<void> {
  const srcDir = `${repoRoot}/templates/bun-create`;
  const dstDir = `${repoRoot}/.bun-create`;
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: srcDir, onlyFiles: true, dot: true })) {
    const srcText = await Bun.file(`${srcDir}/${rel}`)
      .text()
      .catch(() => null);
    if (srcText === null) continue;
    const dstPath = `${dstDir}/${rel}`;
    if (srcText !== (await Bun.file(dstPath).text().catch(() => null))) {
      await Bun.write(dstPath, srcText);
      result.updated.push(`.bun-create/${rel}`);
    } else result.skipped++;
  }
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: dstDir, onlyFiles: true, dot: true })) {
    if (!(await Bun.file(`${srcDir}/${rel}`).exists())) {
      await Bun.file(`${dstDir}/${rel}`)
        .delete()
        .catch(() => {});
      result.removed.push(`.bun-create/${rel}`);
    }
  }
}

async function runSyncCycle(mode: SyncCycleMode): Promise<void> {
  const quiet = mode === "daemon";
  const result = await syncDesktop(REPO_ROOT);
  await syncBunCreateMirror(REPO_ROOT, result);
  const mcp = await provisionUserMcp();
  if (mcp.changed) {
    if (!quiet) console.log("   ✓ mcp.json: unified-shell updated");
    result.updated.push("mcp.json");
  }
  await finalizeSyncArchive(REPO_ROOT, {
    files: [...result.updated, ...result.removed],
    writeArchive: await shouldWriteArchive(REPO_ROOT),
  });

  if (quiet) {
    const total = result.updated.length + result.removed.length;
    if (total > 0) {
      const stamp = new Date().toISOString().slice(11, 19);
      const parts: string[] = [];
      if (result.updated.length) parts.push(`${result.updated.length} updated`);
      if (result.removed.length) parts.push(`${result.removed.length} removed`);
      console.log(`[${stamp}] Synced: ${parts.join(", ")}`);
    }
    return;
  }

  if (result.updated.length === 0 && result.removed.length === 0) {
    console.log("✅ Already up to date.");
    return;
  }
  if (result.updated.length) {
    console.log("📤 Updated:");
    for (const f of result.updated) console.log(`   ✓ ${f}`);
  }
  if (result.removed.length) {
    console.log("🗑️  Removed:");
    for (const f of result.removed) console.log(`   ✗ ${f}`);
  }
  console.log(`   (${result.skipped} files unchanged)`);
}

async function main() {
  const isDaemon = Bun.argv.includes("--daemon");
  const dirty = await hasUncommittedChanges();

  if (dirty && !isDaemon) {
    console.log("⚠️  Repo has uncommitted changes. Sync will reflect working tree, not HEAD.");
  }

  if (isDaemon) {
    console.log("🔄 Starting desktop sync daemon (every 5 minutes)...");
    Bun.cron("*/5 * * * *", () => runSyncCycle("daemon"));
    console.log("   Press Ctrl+C to stop.");
    return;
  }

  await runSyncCycle("interactive");
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});