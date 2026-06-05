#!/usr/bin/env bun
/**
 * scripts/sync-to-desktop.ts
 *
 * Syncs this repo's toolchain source to the desktop install at ~/.kimi-code/.
 *
 * Usage:
 *   bun run scripts/sync-to-desktop.ts          # one-shot sync
 *   bun run scripts/sync-to-desktop.ts --daemon # starts Bun.cron (every 5 min)
 */

import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { computeSyncHashes } from "../src/lib/sync-hashes.ts";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  hasUncommittedChanges,
  writeManifest,
} from "../src/lib/version.ts";

const REPO_ROOT = import.meta.dir + "/..";

async function main() {
  const isDaemon = Bun.argv.includes("--daemon");

  const [desktopVersion, gitHead, dirty] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    hasUncommittedChanges(),
  ]);

  if (dirty && !isDaemon) {
    console.log("⚠️  Repo has uncommitted changes. Sync will reflect working tree, not HEAD.");
  }

  if (isDaemon) {
    console.log("🔄 Starting desktop sync daemon (every 5 minutes)...");
    Bun.cron("*/5 * * * *", async () => {
      const result = await syncDesktop(REPO_ROOT);
      const total = result.updated.length + result.removed.length;
      if (total > 0) {
        const stamp = new Date().toISOString().slice(11, 19);
        const parts: string[] = [];
        if (result.updated.length) parts.push(`${result.updated.length} updated`);
        if (result.removed.length) parts.push(`${result.removed.length} removed`);
        console.log(`[${stamp}] Synced: ${parts.join(", ")}`);

        const head = await getRepoHead();
        const fileHashes = await computeSyncHashes(REPO_ROOT);
        await writeManifest({
          toolchainVersion: TOOLCHAIN_VERSION,
          desktopVersion,
          gitHead: head,
          lastSyncedAt: new Date().toISOString(),
          files: [...result.updated, ...result.removed],
          fileHashes,
        });
      }
    });
    console.log("   Press Ctrl+C to stop.");
    return;
  }

  console.log("🔄 Syncing repo → ~/.kimi-code/ ...");
  const result = await syncDesktop(REPO_ROOT);
  const fileHashes = await computeSyncHashes(REPO_ROOT);

  await writeManifest({
    toolchainVersion: TOOLCHAIN_VERSION,
    desktopVersion,
    gitHead,
    lastSyncedAt: new Date().toISOString(),
    files: [...result.updated, ...result.removed],
    fileHashes,
  });

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

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
