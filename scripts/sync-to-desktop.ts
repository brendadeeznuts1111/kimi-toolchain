#!/usr/bin/env bun
/**
 * Syncs this repo's toolchain source to the desktop install at ~/.kimi-code/.
 */

import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { provisionUserMcp } from "../src/lib/mcp-config.ts";
import { finalizeSyncArchive, shouldWriteArchive } from "../src/harness/sync.ts";
import { hasUncommittedChanges } from "../src/lib/version.ts";
import { join } from "path";
import { scriptRepoRoot } from "../src/lib/paths.ts";

const REPO_ROOT = scriptRepoRoot();

async function main() {
  const isDaemon = Bun.argv.includes("--daemon");
  const dirty = await hasUncommittedChanges();

  if (dirty && !isDaemon) {
    console.log("⚠️  Repo has uncommitted changes. Sync will reflect working tree, not HEAD.");
  }

  if (isDaemon) {
    console.log("🔄 Starting desktop sync daemon (every 5 minutes)...");
    Bun.cron("*/5 * * * *", async () => {
      const result = await syncDesktop(REPO_ROOT);
      const srcDir = join(REPO_ROOT, "templates", "bun-create");
      const dstDir = join(REPO_ROOT, ".bun-create");
      const glob = new Bun.Glob("**/*");
      for await (const rel of glob.scan({ cwd: srcDir, onlyFiles: true, dot: true })) {
        const srcPath = join(srcDir, rel);
        const dstPath = join(dstDir, rel);
        const srcText = await Bun.file(srcPath)
          .text()
          .catch(() => null);
        if (srcText === null) continue;
        const dstText = await Bun.file(dstPath)
          .text()
          .catch(() => null);
        if (srcText !== dstText) {
          await Bun.write(dstPath, srcText);
          result.updated.push(`.bun-create/${rel}`);
        } else {
          result.skipped++;
        }
      }
      const dstGlob = new Bun.Glob("**/*");
      for await (const rel of dstGlob.scan({ cwd: dstDir, onlyFiles: true, dot: true })) {
        const srcPath = join(srcDir, rel);
        if ((await Bun.file(srcPath).exists()) === false) {
          await Bun.file(join(dstDir, rel)).delete().catch(() => {});
          result.removed.push(`.bun-create/${rel}`);
        }
      }
      const mcp = await provisionUserMcp();
      if (mcp.changed) result.updated.push("mcp.json");
      const total = result.updated.length + result.removed.length;
      if (total > 0) {
        const stamp = new Date().toISOString().slice(11, 19);
        const parts: string[] = [];
        if (result.updated.length) parts.push(`${result.updated.length} updated`);
        if (result.removed.length) parts.push(`${result.removed.length} removed`);
        console.log(`[${stamp}] Synced: ${parts.join(", ")}`);
      }
      await finalizeSyncArchive(REPO_ROOT, {
        files: [...result.updated, ...result.removed],
        writeArchive: await shouldWriteArchive(REPO_ROOT),
      });
    });
    console.log("   Press Ctrl+C to stop.");
    return;
  }

  console.log("🔄 Syncing repo → ~/.kimi-code/ ...");
  const result = await syncDesktop(REPO_ROOT);

  console.log("🔄 Syncing bun-create templates → .bun-create/ ...");
  const srcDir = join(REPO_ROOT, "templates", "bun-create");
  const dstDir = join(REPO_ROOT, ".bun-create");
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: srcDir, onlyFiles: true, dot: true })) {
    const srcPath = join(srcDir, rel);
    const dstPath = join(dstDir, rel);
    const srcText = await Bun.file(srcPath)
      .text()
      .catch(() => null);
    if (srcText === null) continue;
    const dstText = await Bun.file(dstPath)
      .text()
      .catch(() => null);
    if (srcText !== dstText) {
      await Bun.write(dstPath, srcText);
      result.updated.push(`.bun-create/${rel}`);
    } else {
      result.skipped++;
    }
  }
  const dstGlob = new Bun.Glob("**/*");
  for await (const rel of dstGlob.scan({ cwd: dstDir, onlyFiles: true, dot: true })) {
    const srcPath = join(srcDir, rel);
    if ((await Bun.file(srcPath).exists()) === false) {
      await Bun.file(join(dstDir, rel)).delete().catch(() => {});
      result.removed.push(`.bun-create/${rel}`);
    }
  }

  const mcp = await provisionUserMcp();
  if (mcp.changed) {
    console.log("   ✓ mcp.json: unified-shell updated");
    result.updated.push("mcp.json");
  }
  await finalizeSyncArchive(REPO_ROOT, {
    files: [...result.updated, ...result.removed],
    writeArchive: await shouldWriteArchive(REPO_ROOT),
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