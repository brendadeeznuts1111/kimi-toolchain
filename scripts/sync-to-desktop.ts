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

import {
  buildCanonicalReferencesManifest,
  repoCanonicalReferencesPath,
} from "../src/lib/canonical-references.ts";
import { stableStringify } from "../src/lib/build-constants-registry.ts";
import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { provisionUserMcp } from "../src/lib/mcp-config.ts";
import { computeSyncHashes } from "../src/lib/sync-hashes.ts";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  hasUncommittedChanges,
  writeManifest,
} from "../src/lib/version.ts";
import { isQuietMode } from "../src/lib/quiet-mode.ts";

const REPO_ROOT = import.meta.dir + "/..";
const KNOWN_FLAGS = new Set(["--daemon", "--dry-run", "--force"]);

async function ensureCanonicalReferencesManifest(): Promise<void> {
  await Bun.write(
    repoCanonicalReferencesPath(REPO_ROOT),
    stableStringify(buildCanonicalReferencesManifest())
  );
}

async function main() {
  await ensureCanonicalReferencesManifest();
  const args = Bun.argv.slice(2);
  const unknown = args.filter((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) {
    console.error(`❌ Unknown sync flag(s): ${unknown.join(", ")}`);
    console.error("Usage: bun run scripts/sync-to-desktop.ts [--dry-run] [--force] [--daemon]");
    process.exit(2);
  }

  const isDaemon = args.includes("--daemon");
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  if (isDaemon && dryRun) {
    console.error("❌ --daemon and --dry-run cannot be combined");
    process.exit(2);
  }

  const [desktopVersion, gitHead, dirty] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    hasUncommittedChanges(),
  ]);

  if (dirty && !isDaemon && !dryRun && !isQuietMode()) {
    console.log("⚠️  Repo has uncommitted changes. Sync will reflect working tree, not HEAD.");
  }

  if (isDaemon) {
    console.log("🔄 Starting desktop sync daemon (every 5 minutes)...");
    Bun.cron("*/5 * * * *", async () => {
      const result = await syncDesktop(REPO_ROOT);
      const mcp = await provisionUserMcp();
      if (mcp.changed) result.updated.push("mcp.json");
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

  if (!isQuietMode()) {
    console.log(
      dryRun ? "🔎 Previewing repo → ~/.kimi-code/ sync ..." : "🔄 Syncing repo → ~/.kimi-code/ ..."
    );
  }
  const result = await syncDesktop(REPO_ROOT, { dryRun, force });
  if (!dryRun) {
    const mcp = await provisionUserMcp();
    if (mcp.changed && !isQuietMode()) {
      console.log("   ✓ mcp.json: unified-shell updated");
      result.updated.push("mcp.json");
    } else if (mcp.changed) {
      result.updated.push("mcp.json");
    }
  }
  const fileHashes = await computeSyncHashes(REPO_ROOT);

  if (!dryRun) {
    await writeManifest({
      toolchainVersion: TOOLCHAIN_VERSION,
      desktopVersion,
      gitHead,
      lastSyncedAt: new Date().toISOString(),
      files: [...result.updated, ...result.removed],
      fileHashes,
    });
  }

  if (result.updated.length === 0 && result.removed.length === 0) {
    if (!isQuietMode())
      console.log(dryRun ? "✅ Would make no changes." : "✅ Already up to date.");
    return;
  }

  if (!isQuietMode()) {
    if (result.updated.length) {
      console.log(dryRun ? "📤 Would update:" : "📤 Updated:");
      for (const f of result.updated) console.log(`   ✓ ${f}`);
    }
    if (result.removed.length) {
      console.log(dryRun ? "🗑️  Would remove:" : "🗑️  Removed:");
      for (const f of result.removed) console.log(`   ✗ ${f}`);
    }
    console.log(`   (${result.skipped} files unchanged)`);
  }
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
