#!/usr/bin/env bun
/**
 * Purge gitignored root clutter: test temp dirs, backup files, accidental paths.
 * Safe to run anytime — only removes known artifact patterns at repo root.
 */

import { existsSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("--dryrun");
const json = args.includes("--json");

interface CleanupItem {
  path: string;
  kind: "tmpdir" | "backup" | "accidental" | "empty";
  bytes: number;
}

function dirSize(path: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  } catch {
    /* skip unreadable subtrees */
  }
  return total;
}

function collectItems(): CleanupItem[] {
  const items: CleanupItem[] = [];

  for (const name of readdirSync(REPO_ROOT)) {
    const full = join(REPO_ROOT, name);

    if (name.startsWith(".tmp-")) {
      items.push({ path: full, kind: "tmpdir", bytes: dirSize(full) });
      continue;
    }

    if (name === "~") {
      items.push({ path: full, kind: "accidental", bytes: dirSize(full) });
      continue;
    }

    if (name.endsWith(".bak") && statSync(full).isFile()) {
      items.push({ path: full, kind: "backup", bytes: statSync(full).size });
    }
  }

  const dxDir = join(REPO_ROOT, "dx");
  if (existsSync(dxDir) && statSync(dxDir).isDirectory() && readdirSync(dxDir).length === 0) {
    items.push({ path: dxDir, kind: "empty", bytes: 0 });
  }

  return items;
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const items = collectItems();
const totalBytes = items.reduce((sum, i) => sum + i.bytes, 0);

if (json) {
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        tool: "cleanup-root-bloat",
        dryRun,
        count: items.length,
        totalBytes,
        items: items.map((i) => ({ ...i, path: i.path.slice(REPO_ROOT.length + 1) })),
      },
      null,
      2
    )
  );
} else if (items.length === 0) {
  console.log("Root is clean — no bloat artifacts found.");
} else {
  console.log(
    dryRun
      ? `Would remove ${items.length} item(s) (${formatBytes(totalBytes)}):`
      : `Removing ${items.length} item(s) (${formatBytes(totalBytes)}):`
  );
  for (const item of items) {
    const rel = item.path.slice(REPO_ROOT.length + 1);
    console.log(`  ${item.kind.padEnd(10)} ${rel} (${formatBytes(item.bytes)})`);
  }
}

if (!dryRun) {
  for (const item of items) {
    rmSync(item.path, { recursive: true, force: true });
  }
}

process.exit(0);
