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

import { join } from "path";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  hasUncommittedChanges,
  writeManifest,
} from "../src/lib/version.ts";

const REPO_ROOT = import.meta.dir + "/..";
const DESKTOP_ROOT = join(Bun.env.HOME || "/tmp", ".kimi-code");
const BIN_SRC = join(REPO_ROOT, "src", "bin");
const BIN_DST = join(DESKTOP_ROOT, "tools");
const LIB_SRC_DIR = join(REPO_ROOT, "src", "lib");
const LIB_DST_DIR = join(DESKTOP_ROOT, "lib");

/** Orphaned files that should be removed from the desktop install */
const ORPHANS = ["kimi-utils.ts"];

interface SyncResult {
  updated: string[];
  removed: string[];
  skipped: number;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function sync(): Promise<SyncResult> {
  const result: SyncResult = { updated: [], removed: [], skipped: 0 };

  // ── Sync bin/*.ts ──────────────────────────────────────────────
  const glob = new Bun.Glob("*.ts");
  for await (const file of glob.scan(BIN_SRC)) {
    const srcPath = join(BIN_SRC, file);
    const dstPath = join(BIN_DST, file);

    const srcText = await Bun.file(srcPath).text();
    const dstText = await readTextOrNull(dstPath);

    if (srcText !== dstText) {
      await Bun.write(dstPath, srcText);
      result.updated.push(`tools/${file}`);
    } else {
      result.skipped++;
    }
  }

  // ── Sync lib/*.ts ──────────────────────────────────────────────
  const libGlob = new Bun.Glob("*.ts");
  for await (const file of libGlob.scan(LIB_SRC_DIR)) {
    const srcPath = join(LIB_SRC_DIR, file);
    const dstPath = join(LIB_DST_DIR, file);
    const srcText = await Bun.file(srcPath).text();
    const dstText = await readTextOrNull(dstPath);
    if (srcText !== dstText) {
      await Bun.write(dstPath, srcText);
      result.updated.push(`lib/${file}`);
    }
  }

  // ── Sync root templates ────────────────────────────────────────
  for (const doc of ["AGENTS.md", "UNIFIED.md", "TEMPLATES.md", "dx.config.toml"]) {
    const srcPath = join(REPO_ROOT, doc);
    const dstPath = join(DESKTOP_ROOT, doc);
    const srcText = await readTextOrNull(srcPath);
    if (srcText === null) continue;
    const dstText = await readTextOrNull(dstPath);
    if (srcText !== dstText) {
      await Bun.write(dstPath, srcText);
      result.updated.push(doc);
    }
  }

  // ── Remove orphaned files ──────────────────────────────────────
  for (const orphan of ORPHANS) {
    const orphanPath = join(BIN_DST, orphan);
    const exists = await readTextOrNull(orphanPath);
    if (exists !== null) {
      await Bun.$`rm -f ${orphanPath}`;
      result.removed.push(`tools/${orphan}`);
    }
  }

  return result;
}

async function main() {
  const isDaemon = Bun.argv.includes("--daemon");

  // ── Pre-sync checks ────────────────────────────────────────────
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
      const result = await sync();
      const total = result.updated.length + result.removed.length;
      if (total > 0) {
        const stamp = new Date().toISOString().slice(11, 19);
        const parts: string[] = [];
        if (result.updated.length) parts.push(`${result.updated.length} updated`);
        if (result.removed.length) parts.push(`${result.removed.length} removed`);
        console.log(`[${stamp}] Synced: ${parts.join(", ")}`);

        // Rewrite manifest on every sync
        const head = await getRepoHead();
        await writeManifest({
          toolchainVersion: TOOLCHAIN_VERSION,
          desktopVersion,
          gitHead: head,
          lastSyncedAt: new Date().toISOString(),
          files: [...result.updated, ...result.removed],
        });
      }
    });
    console.log("   Press Ctrl+C to stop.");
    return;
  }

  console.log("🔄 Syncing repo → ~/.kimi-code/ ...");
  const result = await sync();

  // ── Write manifest ─────────────────────────────────────────────
  await writeManifest({
    toolchainVersion: TOOLCHAIN_VERSION,
    desktopVersion,
    gitHead,
    lastSyncedAt: new Date().toISOString(),
    files: [...result.updated, ...result.removed],
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
