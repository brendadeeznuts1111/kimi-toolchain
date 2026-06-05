/**
 * Sync hash utilities — detect repo vs desktop runtime drift.
 */

import { existsSync } from "fs";
import { join } from "path";
import { DESKTOP_ROOT } from "./desktop-sync.ts";
import { sha256File } from "./utils.ts";

/** Compute sha256 hashes for all sync-managed source files. */
export async function computeSyncHashes(repoRoot: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  const binDir = join(repoRoot, "src", "bin");
  const libDir = join(repoRoot, "src", "lib");
  const scriptsDir = join(repoRoot, "scripts");

  const binGlob = new Bun.Glob("*.ts");
  for await (const file of binGlob.scan(binDir)) {
    hashes[`tools/${file}`] = await sha256File(join(binDir, file));
  }

  const libGlob = new Bun.Glob("*.ts");
  for await (const file of libGlob.scan(libDir)) {
    hashes[`lib/${file}`] = await sha256File(join(libDir, file));
  }

  if (existsSync(scriptsDir)) {
    const scriptsGlob = new Bun.Glob("*.ts");
    for await (const file of scriptsGlob.scan(scriptsDir)) {
      hashes[`scripts/${file}`] = await sha256File(join(scriptsDir, file));
    }
  }

  return hashes;
}

function desktopPathForKey(key: string): string | null {
  if (key.startsWith("tools/")) return join(DESKTOP_ROOT, "tools", key.slice(6));
  if (key.startsWith("lib/")) return join(DESKTOP_ROOT, "lib", key.slice(4));
  if (key.startsWith("scripts/")) return join(DESKTOP_ROOT, "scripts", key.slice(8));
  return null;
}

export interface SyncDriftReport {
  drifted: string[];
  missing: string[];
  synced: boolean;
}

/** Compare repo hashes against on-disk desktop install. */
export async function detectSyncDrift(repoRoot: string): Promise<SyncDriftReport> {
  const repoHashes = await computeSyncHashes(repoRoot);
  const drifted: string[] = [];
  const missing: string[] = [];

  for (const [key, repoHash] of Object.entries(repoHashes)) {
    if (!key.startsWith("tools/") && !key.startsWith("lib/") && !key.startsWith("scripts/")) {
      continue;
    }

    const dstPath = desktopPathForKey(key);
    if (!dstPath || !existsSync(dstPath)) {
      missing.push(key);
      continue;
    }

    const desktopHash = await sha256File(dstPath);
    if (desktopHash !== repoHash) {
      drifted.push(key);
    }
  }

  return {
    drifted,
    missing,
    synced: drifted.length === 0 && missing.length === 0,
  };
}
